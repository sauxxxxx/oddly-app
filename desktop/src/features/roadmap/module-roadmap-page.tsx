import { ArrowLeft, CircleDashed, Lock, MapPinned } from "lucide-react";
import { Link, useLocation } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ALL_MODULES, SETTINGS_ROADMAP } from "@/config/navigation";
import { useAuth } from "@/features/auth/auth-context";

const PHASE_NAMES: Record<number, string> = {
  2: "Lead Management",
  3: "CRM & Sales",
  4: "Client Management",
  5: "Agency Operations",
  6: "Analytics & AI",
  7: "Production Readiness",
};

/**
 * Honest placeholder for modules that aren't built yet: says what's coming and when,
 * instead of showing fake data or dead buttons.
 */
export function ModuleRoadmapPage() {
  const { pathname } = useLocation();
  const { can } = useAuth();

  const module = ALL_MODULES.find((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(m.path + "/")));
  const child = module?.children?.find((c) => c.path === pathname);

  if (!module || (module.children && !child && pathname !== module.path)) {
    return (
      <Card>
        <EmptyState
          icon={MapPinned}
          title="Page not found"
          description="This page doesn't exist. Use the sidebar or press Ctrl K to find what you need."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/">
                <ArrowLeft /> Back to dashboard
              </Link>
            </Button>
          }
        />
      </Card>
    );
  }

  if (!can(module.permission) || !can(child?.permission)) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="You don't have access to this page"
          description="Ask an administrator if you need it for your work."
        />
      </Card>
    );
  }

  const settings = SETTINGS_ROADMAP[pathname];
  const phase = settings?.phase ?? module.phase;
  const summary = settings?.summary ?? module.summary;
  const planned = settings?.planned ?? module.planned;
  const title = child?.label ?? module.label;

  return (
    <>
      <PageHeader
        title={title}
        description={summary}
        actions={
          <Badge tone="accent" className="px-3 py-1 text-xs">
            Planned · Phase {phase}
            {PHASE_NAMES[phase] && ` — ${PHASE_NAMES[phase]}`}
          </Badge>
        }
      />
      <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="What this module will do" description="Built incrementally, module by module, on the live database." />
          <CardBody>
            <ul className="flex flex-col gap-3">
              {planned.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-muted">
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-accent" />
                  {item}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="Already in place" />
          <CardBody>
            <p className="text-sm leading-relaxed text-muted">
              The database tables, relationships and permissions for {module.label.toLowerCase()} already exist, so this
              module will plug straight into the same records the dashboard reads.
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link to="/">
                <ArrowLeft /> Back to dashboard
              </Link>
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
