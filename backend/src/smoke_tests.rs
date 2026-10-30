//! End-to-end smoke tests against a real database, calling handlers directly as the
//! workspace owner. Opt-in only (they write and then delete tagged rows):
//!
//!   ODDLY_SMOKE=1 cargo test -p oddly-api smoke -- --nocapture --test-threads=1
//!
//! Every record created uses the `__oddly_smoke__` prefix and is hard-deleted at the end.

use std::collections::HashSet;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

use crate::{auth::AuthUser, config::Config, routes, state::AppState};

pub const TAG: &str = "__oddly_smoke__";

pub async fn setup() -> Option<(AppState, AuthUser)> {
    if std::env::var("ODDLY_SMOKE").ok().as_deref() != Some("1") {
        eprintln!("skipping smoke test (set ODDLY_SMOKE=1)");
        return None;
    }
    dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();
    let config = Config::from_env().expect("config");
    let db = PgPoolOptions::new().max_connections(5).connect(&config.database_url).await.expect("db");
    let (id, email, full_name): (Uuid, String, String) = sqlx::query_as(
        "select p.id, p.email, p.full_name from public.profiles p
         join public.user_roles ur on ur.user_id = p.id join public.roles r on r.id = ur.role_id
         where r.key = 'super_admin' order by p.created_at limit 1",
    )
    .fetch_one(&db)
    .await
    .expect("owner account");
    let user = AuthUser {
        id,
        email,
        full_name,
        job_title: None,
        phone: None,
        timezone: "Asia/Manila".into(),
        must_change_password: false,
        roles: vec!["super_admin".into()],
        permissions: HashSet::new(),
    };
    Some((AppState::new(config, db).expect("state"), user))
}

pub fn to_value<T: serde::Serialize>(r: Result<Json<T>, crate::error::AppError>) -> Value {
    match r {
        Ok(Json(v)) => serde_json::to_value(v).unwrap(),
        Err(e) => panic!("handler failed: {e:?}"),
    }
}

pub fn de<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).expect("valid input json")
}

/// Hard-deletes everything the smoke tests created.
pub async fn cleanup(state: &AppState, actor: Uuid) {
    let pattern = format!("{TAG}%");
    // Bulk/export audit rows carry no lead id; remove the ones this test run produced.
    sqlx::query("delete from public.audit_logs where actor_id = $1 and action in ('leads.exported', 'leads.bulk_updated', 'leads.merged') and created_at > now() - interval '15 minutes'")
        .bind(actor).execute(&state.db).await.expect("audit cleanup");
    let leads = "(select l.id from public.leads l join public.companies c on c.id = l.company_id where c.name like $1)";
    let companies = "(select id from public.companies where name like $1)";
    let sales: Vec<String> = vec![
        format!("delete from public.notifications where entity_id in (select id from public.follow_ups where lead_id in {leads})
                 or entity_id in (select id from public.meetings where lead_id in {leads})"),
        format!("delete from public.meeting_participants where meeting_id in (select id from public.meetings where lead_id in {leads})"),
        format!("delete from public.meetings where lead_id in {leads}"),
        format!("delete from public.follow_ups where lead_id in {leads}"),
        format!("delete from public.lead_interactions where lead_id in {leads}"),
        format!("delete from public.activities where entity_type = 'client' and entity_id in (select id from public.clients where company_id in {companies})"),
        format!("delete from public.audit_logs where entity_id in (select id from public.clients where company_id in {companies})"),
        format!("delete from public.clients where company_id in {companies}"),
        format!("delete from public.proposals where company_id in {companies} or title like $1"),
        format!("delete from public.deals where company_id in {companies}"),
        "delete from public.audit_logs where entity_id in (select id from public.pipeline_stages where name like $1)".to_owned(),
        "delete from public.pipeline_stages where name like $1".to_owned(),
    ];
    for sql in &sales {
        sqlx::query(sql).bind(&pattern).execute(&state.db).await.expect(sql);
    }
    let statements = [
        "delete from public.activities where entity_type = 'lead' and entity_id in
           (select l.id from public.leads l join public.companies c on c.id = l.company_id where c.name like $1)",
        "delete from public.audit_logs where entity_id in
           (select l.id from public.leads l join public.companies c on c.id = l.company_id where c.name like $1)",
        "delete from public.lead_list_members where lead_id in
           (select l.id from public.leads l join public.companies c on c.id = l.company_id where c.name like $1)",
        "delete from public.lead_research where lead_id in
           (select l.id from public.leads l join public.companies c on c.id = l.company_id where c.name like $1)",
        "delete from public.leads where company_id in (select id from public.companies where name like $1)",
        "delete from public.contacts where company_id in (select id from public.companies where name like $1)",
        "delete from public.companies where name like $1",
        "delete from public.lead_list_assignees where list_id in (select id from public.lead_lists where name like $1)",
        "delete from public.lead_lists where name like $1",
        "delete from public.import_jobs where file_name like $1",
        "delete from public.saved_filters where name like $1",
    ];
    for sql in statements {
        sqlx::query(sql).bind(&pattern).execute(&state.db).await.expect(sql);
    }
}

#[tokio::test]
async fn smoke_leads() {
    let Some((state, user)) = setup().await else { return };
    cleanup(&state, user.id).await;
    let st = || State(state.clone());
    let u = || user.clone();

    // Read-only endpoints.
    let lookups = to_value(routes::lookups::lookups(st(), u()).await);
    assert_eq!(lookups["pipeline_stages"].as_array().unwrap().len(), 8, "{lookups}");
    to_value(routes::dashboard::summary(st(), u(), Query(de(json!({})))).await);

    // Create, then a duplicate is detected.
    let input = json!({
        "business_name": format!("{TAG} Barili Bakery"), "market": "local", "city": "Barili", "country": "Philippines",
        "website_url": "https://www.smoke-barili-bakery.test/menu", "business_phone": "+63 917 555 0101",
        "contact_name": "Ana Cruz", "contact_email": "ana@smoke-barili-bakery.test", "priority": "high",
        "potential_services": ["Social media", "Website"], "estimated_value": "15000", "currency": "PHP",
        "next_action": "Call the owner"
    });
    let mut no_action = input.clone();
    no_action["next_action"] = json!(null);
    assert!(
        routes::leads::create(st(), u(), Json(de(no_action))).await.is_err(),
        "active leads must require a next action"
    );
    let created = to_value(routes::leads::create(st(), u(), Json(de(input.clone()))).await);
    assert_eq!(created["result"], "created", "{created}");
    let lead_id: Uuid = de(created["lead"]["id"].clone());

    let mut dup = input.clone();
    dup["business_name"] = json!(format!("{TAG} Barili Bakery Inc"));
    dup["website_url"] = json!("smoke-barili-bakery.test");
    let dup_res = to_value(routes::leads::create(st(), u(), Json(de(dup))).await);
    assert_eq!(dup_res["result"], "possible_duplicates", "{dup_res}");
    assert_eq!(dup_res["duplicates"][0]["matched_by"], "website");

    // List with filters, detail, update.
    let list = to_value(
        routes::leads::list(st(), u(), Query(de(json!({ "search": TAG, "market": "local", "sort": "priority" })))).await,
    );
    assert_eq!(list["total"], 1, "{list}");
    to_value(routes::leads::get(st(), u(), Path(lead_id)).await);
    let mut upd = input.clone();
    upd["city"] = json!("Cebu City");
    upd["contact_position"] = json!("Owner");
    let updated = to_value(routes::leads::update(st(), u(), Path(lead_id), Json(de(upd))).await);
    assert_eq!(updated["city"], "Cebu City");
    assert_eq!(updated["contact_position"], "Owner");

    // Research.
    let research = to_value(
        routes::leads::research::save(
            st(),
            u(),
            Path(lead_id),
            Json(de(json!({ "website_quality": 2, "social_activity": 4, "findings": "Active FB page, weak site." }))),
        )
        .await,
    );
    assert_eq!(research["website_quality"], 2);

    // Lead list + bulk add + list filter.
    let list_row = to_value(
        routes::leads::lists::create(st(), u(), Json(de(json!({ "name": format!("{TAG} Cebu Bakeries"), "assignee_ids": [user.id] })))).await,
    );
    let list_id: Uuid = de(list_row["id"].clone());
    to_value(routes::leads::bulk(st(), u(), Json(de(json!({ "action": "add_to_list", "list_id": list_id, "ids": [lead_id] })))).await);
    let in_list = to_value(routes::leads::list(st(), u(), Query(de(json!({ "list_id": list_id })))).await);
    assert_eq!(in_list["total"], 1);
    let lists = to_value(routes::leads::lists::list(st(), u()).await);
    assert!(lists.as_array().unwrap().iter().any(|l| l["id"] == json!(list_id) && l["total"] == 1), "{lists}");

    // Import: preview flags the existing lead and an in-file repeat; update mode fills it.
    let rows = json!([
        { "business_name": format!("{TAG} Barili Bakery"), "market": "local", "city": "Cebu City",
          "website_url": "http://smoke-barili-bakery.test", "industry": "Food", "source_name": "Google Maps" },
        { "business_name": format!("{TAG} Moalboal Dive Shop"), "market": "local", "city": "Moalboal",
          "contact_email": "hello@smoke-moalboal.test", "source_name": "facebook" },
        { "business_name": format!("{TAG} Moalboal Dive Shop"), "market": "local", "city": "Moalboal" },
        { "business_name": "", "market": "local" },
        { "business_name": format!("{TAG} Austin Realty"), "market": "international", "country": "United States",
          "estimated_value": "2500", "currency": "USD", "stage_name": "Interested" }
    ]);
    let preview = to_value(
        routes::leads::import::preview(st(), u(), Json(de(json!({ "rows": rows, "offset": 0 })))).await,
    );
    let issues = preview.as_array().unwrap();
    assert!(issues.iter().any(|i| i["index"] == 0 && i["duplicate"]["lead_id"] == json!(lead_id)), "{preview}");
    assert!(issues.iter().any(|i| i["index"] == 2 && i["duplicate_of_row"] == 1), "{preview}");
    assert!(issues.iter().any(|i| i["index"] == 3 && i["errors"]["business_name"].is_string()), "{preview}");

    let imported = to_value(
        routes::leads::import::import(
            st(),
            u(),
            Json(de(json!({ "file_name": format!("{TAG}.xlsx"), "mode": "update", "rows": rows, "total_rows": 5,
                            "last": true, "options": { "list_id": list_id } }))),
        )
        .await,
    );
    let outcomes: Vec<&str> = imported["results"].as_array().unwrap().iter().map(|r| r["outcome"].as_str().unwrap()).collect();
    assert_eq!(outcomes, vec!["updated", "created", "skipped", "failed", "created"], "{imported}");
    let after = to_value(routes::leads::get(st(), u(), Path(lead_id)).await);
    assert_eq!(after["industry"], "Food", "update mode should fill blanks: {after}");
    let austin = to_value(routes::leads::list(st(), u(), Query(de(json!({ "search": "Austin Realty" })))).await);
    assert_eq!(austin["items"][0]["stage_name"], "Interested", "{austin}");
    assert_eq!(austin["items"][0]["currency"], "USD");
    let history = to_value(routes::leads::import::history(st(), u()).await);
    assert!(history.as_array().unwrap().iter().any(|j| j["created"] == 2 && j["updated"] == 1), "{history}");

    // Export, facets, duplicates scan, saved filter.
    let export = to_value(routes::leads::export(st(), u(), Query(de(json!({ "search": TAG })))).await);
    assert_eq!(export.as_array().unwrap().len(), 3, "{export}");
    to_value(routes::leads::facets(st(), u()).await);
    to_value(routes::leads::duplicates::groups(st(), u()).await);
    let saved = to_value(
        routes::saved_filters::create(st(), u(), Json(de(json!({ "module": "leads", "name": format!("{TAG} hot"), "filters": { "priority": "high" } })))).await,
    );
    assert_eq!(saved["mine"], true);

    // Merge two leads, then bulk delete.
    let dive = to_value(routes::leads::list(st(), u(), Query(de(json!({ "search": "Moalboal Dive" })))).await);
    let dive_id: Uuid = de(dive["items"][0]["id"].clone());
    let merged = to_value(
        routes::leads::duplicates::merge(st(), u(), Json(de(json!({ "keep_id": lead_id, "merge_ids": [dive_id] })))).await,
    );
    assert_eq!(merged["id"], json!(lead_id));
    let left = to_value(routes::leads::list(st(), u(), Query(de(json!({ "search": TAG })))).await);
    assert_eq!(left["total"], 2, "{left}");
    let ids: Vec<Uuid> = left["items"].as_array().unwrap().iter().map(|i| de(i["id"].clone())).collect();
    let bulk = to_value(routes::leads::bulk(st(), u(), Json(de(json!({ "action": "delete", "ids": ids })))).await);
    assert_eq!(bulk["affected"], 2);

    cleanup(&state, user.id).await;
    eprintln!("smoke_leads: OK");
}

#[tokio::test]
async fn smoke_sales() {
    let Some((state, user)) = setup().await else { return };
    cleanup(&state, user.id).await;
    let st = || State(state.clone());
    let u = || user.clone();

    let created = to_value(
        routes::leads::create(st(), u(), Json(de(json!({
            "business_name": format!("{TAG} Moalboal Resort"), "market": "local", "city": "Moalboal",
            "contact_name": "Ben Reyes", "contact_email": "ben@smoke-moalboal-resort.test",
            "next_action": "Message on Facebook", "estimated_value": "40000", "currency": "PHP"
        })))).await,
    );
    let lead_id: Uuid = de(created["lead"]["id"].clone());

    // Outreach moves a new prospect to "Contacted" and stamps last contact.
    to_value(
        routes::sales::interactions::log(st(), u(), Path(lead_id), Json(de(json!({
            "channel": "facebook", "body": "Sent intro message with 3 page ideas",
            "next_action": "Wait for reply", "follow_up": { "title": "Check FB reply", "due_at": "2026-11-05T01:00:00Z" }
        })))).await,
    );
    let lead = to_value(routes::leads::get(st(), u(), Path(lead_id)).await);
    assert_eq!(lead["stage_name"], "Contacted", "{lead}");
    assert!(lead["last_contacted_at"].is_string());
    assert_eq!(lead["next_action"], "Wait for reply");
    let history = to_value(routes::sales::interactions::list(st(), u(), Query(de(json!({ "lead_id": lead_id })))).await);
    assert_eq!(history["total"], 1);

    // Follow-ups: recurring completion schedules the next one.
    let fu = to_value(
        routes::sales::follow_ups::create(st(), u(), Json(de(json!({
            "lead_id": lead_id, "title": format!("{TAG} weekly check-in"), "due_at": "2026-10-01T01:00:00Z", "recurrence": "weekly"
        })))).await,
    );
    assert_eq!(fu["overdue"], true);
    let fu_id: Uuid = de(fu["id"].clone());
    crate::reminders::run_once(&state.db).await.expect("reminders");
    let notes: i64 = sqlx::query_scalar("select count(*) from public.notifications where entity_id = $1").bind(fu_id).fetch_one(&state.db).await.unwrap();
    assert_eq!(notes, 1, "overdue follow-up should notify once");
    to_value(routes::sales::follow_ups::complete(st(), u(), Path(fu_id)).await);
    let pending = to_value(routes::sales::follow_ups::list(st(), u(), Query(de(json!({ "lead_id": lead_id })))).await);
    assert_eq!(pending["total"], 2, "next weekly occurrence + the FB follow-up: {pending}");

    // Meetings.
    let meeting = to_value(
        routes::sales::meetings::create(st(), u(), Json(de(json!({
            "title": format!("{TAG} Discovery call"), "starts_at": "2026-11-03T02:00:00Z", "ends_at": "2026-11-03T03:00:00Z",
            "lead_id": lead_id, "meeting_url": "https://meet.example.test/abc", "participant_ids": [user.id],
            "external": [{ "name": "Ben Reyes", "email": "ben@smoke-moalboal-resort.test" }]
        })))).await,
    );
    assert_eq!(meeting["participants"].as_array().unwrap().len(), 2, "{meeting}");
    let mid: Uuid = de(meeting["id"].clone());
    let done = to_value(
        routes::sales::meetings::update(st(), u(), Path(mid), Json(de(json!({
            "title": format!("{TAG} Discovery call"), "starts_at": "2026-11-03T02:00:00Z", "lead_id": lead_id,
            "status": "completed", "outcome": "Interested in social media package", "next_action": "Send proposal",
            "participant_ids": [user.id]
        })))).await,
    );
    assert_eq!(done["status"], "completed");
    let listed = to_value(routes::sales::meetings::list(st(), u(), Query(de(json!({ "lead_id": lead_id })))).await);
    assert_eq!(listed.as_array().unwrap().len(), 1);

    // Pipeline board + drag to Interested.
    let board = to_value(routes::sales::pipeline::board(st(), u(), Query(de(json!({ "search": TAG })))).await);
    let interested = board.as_array().unwrap().iter().find(|c| c["name"] == "Interested").unwrap()["id"].clone();
    to_value(routes::sales::pipeline::move_lead(st(), u(), Path(lead_id), Json(de(json!({ "stage_id": interested })))).await);
    let board = to_value(routes::sales::pipeline::board(st(), u(), Query(de(json!({ "search": TAG })))).await);
    let col = board.as_array().unwrap().iter().find(|c| c["name"] == "Interested").unwrap();
    assert_eq!(col["count"], 1, "{col}");
    assert_eq!(col["totals"]["PHP"], "40000.00");

    // Deal + proposal: totals are computed server-side.
    let deal = to_value(
        routes::sales::deals::create(st(), u(), Json(de(json!({ "lead_id": lead_id, "title": "Social media package", "value": "20000", "currency": "PHP" })))).await,
    );
    let deal_id: Uuid = de(deal["id"].clone());
    let proposal = to_value(routes::sales::proposals::create(st(), u(), Json(de(json!({ "deal_id": deal_id })))).await);
    let pid: Uuid = de(proposal["id"].clone());
    let saved = to_value(
        routes::sales::proposals::save(st(), u(), Path(pid), Json(de(json!({
            "title": format!("{TAG} Social media proposal"), "currency": "PHP", "discount_type": "percent", "discount_value": "10",
            "tax_rate": "12", "valid_until": "2026-12-31", "introduction": "Thanks for meeting us.", "terms": "50% upfront.",
            "items": [
                { "name": "Social media management", "quantity": "2", "unit_price": "10000", "billing_type": "monthly", "deliverables": ["12 posts", "Monthly report"] },
                { "name": "Brand kit", "quantity": "1", "unit_price": "0", "billing_type": "one_time", "deliverables": [] }
            ]
        })))).await,
    );
    assert_eq!(saved["subtotal"], "20000.00", "{saved}");
    assert_eq!(saved["discount_amount"], "2000.00");
    assert_eq!(saved["tax_amount"], "2160.00");
    assert_eq!(saved["total"], "20160.00");

    for status in ["ready", "sent", "accepted"] {
        let r = to_value(routes::sales::proposals::set_status(st(), u(), Path(pid), Json(de(json!({ "status": status })))).await);
        assert_eq!(r["status"], status, "{r}");
    }
    let detail = to_value(routes::sales::proposals::get(st(), u(), Path(pid)).await);
    assert_eq!(detail["versions"].as_array().unwrap().len(), 1, "sending snapshots a version");
    assert_eq!(detail["recipient"]["contact_name"], "Ben Reyes");
    let deal = to_value(routes::sales::deals::list(st(), u(), Query(de(json!({ "lead_id": lead_id })))).await);
    assert_eq!(deal["items"][0]["status"], "won", "{deal}");
    assert_eq!(deal["items"][0]["value"], "20160.00");
    // Accepted proposals can be saved as templates.
    let tmpl = to_value(routes::sales::proposals::duplicate(st(), u(), Path(pid), Json(de(json!({ "as_template": true })))).await);
    assert_eq!(tmpl["is_template"], true);
    assert_eq!(tmpl["items"].as_array().unwrap().len(), 2);

    // Conversion reuses the company; converting twice returns the same client.
    let converted = to_value(
        routes::sales::conversion::convert(st(), u(), Path(lead_id), Json(de(json!({
            "deal_id": deal_id, "proposal_id": pid,
            "services": [{ "name": "Social media management", "price": "10000", "currency": "PHP", "billing_type": "monthly" }]
        })))).await,
    );
    assert_eq!(converted["already_client"], false);
    let again = to_value(routes::sales::conversion::convert(st(), u(), Path(lead_id), Json(de(json!({})))).await);
    assert_eq!(again["client_id"], converted["client_id"]);
    let lead = to_value(routes::leads::get(st(), u(), Path(lead_id)).await);
    assert_eq!(lead["status"], "converted");
    assert_eq!(lead["client_id"], converted["client_id"]);

    // Stage customization.
    let stage = to_value(routes::sales::pipeline::create_stage(st(), u(), Json(de(json!({ "name": format!("{TAG} Nurture"), "color": "#14B8A6" })))).await);
    let stage_id: Uuid = de(stage["id"].clone());
    to_value(routes::sales::pipeline::update_stage(st(), u(), Path(stage_id), Json(de(json!({ "name": format!("{TAG} Nurturing") })))).await);
    let new_prospect: Uuid = sqlx::query_scalar("select id from public.pipeline_stages where name = 'New Prospect'").fetch_one(&state.db).await.unwrap();
    routes::sales::pipeline::remove_stage(st(), u(), Path(stage_id), Query(de(json!({ "move_to": new_prospect })))).await.expect("remove stage");

    to_value(routes::dashboard::summary(st(), u(), Query(de(json!({})))).await);
    cleanup(&state, user.id).await;
    eprintln!("smoke_sales: OK");
}
#[tokio::test]
async fn smoke_clients() {
    let Some((state, user)) = setup().await else { return };
    cleanup(&state, user.id).await;
    let st = || State(state.clone());
    let u = || user.clone();

    // A lead with the same business blocks a manual client (use conversion instead)...
    let lead = to_value(
        routes::leads::create(st(), u(), Json(de(json!({
            "business_name": format!("{TAG} Oslob Whale Tours"), "market": "local", "city": "Oslob",
            "website_url": "smoke-oslob-whales.test", "next_action": "Call"
        })))).await,
    );
    let dup = routes::clients::create(st(), u(), Json(de(json!({ "business_name": format!("{TAG} Oslob Whale Tours"), "market": "local", "website_url": "https://smoke-oslob-whales.test" })))).await;
    assert!(matches!(dup, Err(crate::error::AppError::Conflict(_))), "duplicate of a lead must be refused");

    // ...but a new business can be added directly.
    let client = to_value(
        routes::clients::create(st(), u(), Json(de(json!({
            "business_name": format!("{TAG} Sydney Dental"), "market": "international", "country": "Australia", "city": "Sydney",
            "contact_name": "Dr. Kim", "contact_email": "kim@smoke-sydney-dental.test", "status": "onboarding"
        })))).await,
    );
    let cid: Uuid = de(client["id"].clone());
    assert_eq!(client["company"]["market"], "international");
    assert_eq!(client["contacts"].as_array().unwrap().len(), 1);

    // Services -> monthly value per currency.
    let with_services = to_value(routes::clients::add_service(st(), u(), Path(cid), Json(de(json!({ "name": "Social media management", "price": "900", "currency": "AUD", "billing_type": "monthly" })))).await);
    to_value(routes::clients::add_service(st(), u(), Path(cid), Json(de(json!({ "name": "Website maintenance", "price": "1200", "currency": "AUD", "billing_type": "yearly" })))).await);
    let detail = to_value(routes::clients::get(st(), u(), Path(cid)).await);
    assert_eq!(detail["monthly_value"]["AUD"], "1000.00", "900 monthly + 1200/12: {detail}");
    let sid: Uuid = de(with_services["services"][0]["id"].clone());
    to_value(routes::clients::update_service(st(), u(), Path((cid, sid)), Json(de(json!({ "name": "Social media management", "price": "950", "currency": "AUD", "billing_type": "monthly", "status": "paused" })))).await);

    // Contacts.
    let c2 = to_value(routes::clients::add_contact(st(), u(), Path(cid), Json(de(json!({ "full_name": "Ana Lee", "position": "Office manager", "is_primary": true })))).await);
    let contacts = c2["contacts"].as_array().unwrap();
    assert_eq!(contacts.len(), 2);
    assert_eq!(contacts[0]["full_name"], "Ana Lee", "new primary contact first");

    // Onboarding checklist: finishing it activates the client.
    let ob = to_value(routes::clients::start_onboarding(st(), u(), Path(cid)).await);
    let items: Vec<Uuid> = ob["onboarding"].as_array().unwrap().iter().map(|i| de(i["id"].clone())).collect();
    assert_eq!(items.len(), 7);
    let mut last = json!(null);
    for t in items {
        last = to_value(routes::clients::toggle_onboarding(st(), u(), Path((cid, t)), Json(de(json!({ "done": true })))).await);
    }
    assert_eq!(last["status"], "active", "{last}");

    // Contracts.
    let k = to_value(
        routes::clients::contracts::create(st(), u(), Path(cid), Json(de(json!({
            "title": format!("{TAG} Retainer 2026"), "status": "signed", "start_date": "2026-11-01", "end_date": "2026-11-20",
            "value": "11400", "currency": "AUD", "billing_cycle": "monthly"
        })))).await,
    );
    assert_eq!(k["status"], "signed");
    let expiring = to_value(routes::clients::contracts::list(st(), u(), Query(de(json!({ "expiring_days": 30 })))).await);
    assert!(expiring.as_array().unwrap().iter().any(|c| c["id"] == k["id"]), "{expiring}");

    // Files: real upload to private storage, verified, downloadable, deletable.
    let ticket = to_value(
        routes::files::upload_url(st(), u(), Json(de(json!({
            "bucket": "documents", "entity_type": "client", "entity_id": cid, "file_name": "brand guide.pdf",
            "content_type": "application/pdf", "size_bytes": 20
        })))).await,
    );
    let put = reqwest::Client::new()
        .put(ticket["upload_url"].as_str().unwrap())
        .header("content-type", "application/pdf")
        .body(b"%PDF-1.4 smoke test\n".to_vec())
        .send()
        .await
        .unwrap();
    assert!(put.status().is_success(), "upload failed: {}", put.text().await.unwrap_or_default());
    let file = to_value(
        routes::files::register(st(), u(), Json(de(json!({
            "bucket": "documents", "storage_path": ticket["storage_path"], "entity_type": "client", "entity_id": cid,
            "original_name": "brand guide.pdf", "category": "brand_guideline"
        })))).await,
    );
    assert_eq!(file["size_bytes"], 20, "{file}");
    let fid: Uuid = de(file["id"].clone());
    let link = to_value(routes::files::download(st(), u(), Path(fid), Query(de(json!({ "attachment": true })))).await);
    let got = reqwest::get(link["url"].as_str().unwrap()).await.unwrap().bytes().await.unwrap();
    assert_eq!(&got[..], b"%PDF-1.4 smoke test\n");
    // A path for another record is refused.
    let bad = routes::files::register(st(), u(), Json(de(json!({
        "bucket": "documents", "storage_path": ticket["storage_path"], "entity_type": "client", "entity_id": Uuid::new_v4(), "original_name": "x.pdf"
    })))).await;
    assert!(bad.is_err());
    routes::files::remove(st(), u(), Path(fid)).await.expect("delete file");

    // Lists, history, feed, catalog, status.
    let list = to_value(routes::clients::list(st(), u(), Query(de(json!({ "search": TAG })))).await);
    assert_eq!(list["total"], 1);
    let hist = to_value(routes::clients::history(st(), u(), Path(cid)).await);
    assert!(hist.as_array().unwrap().len() >= 3, "{hist}");
    to_value(routes::clients::feed(st(), u(), Query(de(json!({})))).await);
    let catalog = to_value(routes::clients::services::list(st(), u()).await);
    assert!(catalog.as_array().unwrap().len() >= 8);
    let at_risk = to_value(routes::clients::set_status(st(), u(), Path(cid), Json(de(json!({ "status": "at_risk" })))).await);
    assert_eq!(at_risk["status"], "at_risk");
    let _ = lead;

    sqlx::query("delete from public.files where entity_id = $1").bind(cid).execute(&state.db).await.unwrap();
    sqlx::query("delete from public.tasks where client_id = $1").bind(cid).execute(&state.db).await.unwrap();
    sqlx::query("delete from public.contracts where client_id = $1").bind(cid).execute(&state.db).await.unwrap();
    sqlx::query("delete from public.audit_logs where entity_id = $1 or (action = 'file.deleted' and entity_id = $2)").bind(cid).bind(fid).execute(&state.db).await.unwrap();
    cleanup(&state, user.id).await;
    eprintln!("smoke_clients: OK");
}