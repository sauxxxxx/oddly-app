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
