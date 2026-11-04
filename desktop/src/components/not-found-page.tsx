import { Link } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Button asChild variant="secondary">
        <Link to="/">Back to Dashboard</Link>
      </Button>
    </>
  );
}
