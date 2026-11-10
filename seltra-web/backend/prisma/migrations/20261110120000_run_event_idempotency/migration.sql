ALTER TABLE "run_events" ADD COLUMN "eventKey" TEXT;

CREATE UNIQUE INDEX "run_events_runId_eventKey_key" ON "run_events"("runId", "eventKey");
