-- Watch mode columns on workflows table
ALTER TABLE workflows ADD COLUMN mode TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE workflows ADD COLUMN interval_minutes INTEGER;
ALTER TABLE workflows ADD COLUMN max_runs INTEGER;
ALTER TABLE workflows ADD COLUMN expires_at INTEGER;
ALTER TABLE workflows ADD COLUMN stop_condition TEXT;
ALTER TABLE workflows ADD COLUMN watch_status TEXT;
ALTER TABLE workflows ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0;

-- Watch run tracking columns on workflow_runs table
ALTER TABLE workflow_runs ADD COLUMN run_number INTEGER;
ALTER TABLE workflow_runs ADD COLUMN stop_condition_satisfied INTEGER;
ALTER TABLE workflow_runs ADD COLUMN stop_condition_reason TEXT;
