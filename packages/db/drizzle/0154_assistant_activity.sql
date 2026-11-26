-- What the activity list and the trace retention pass read through. The list
-- walks a tenant's conversations newest first and, with a filter, tests each
-- against its turns, events and cards by their own keys; retention takes the
-- oldest rows past a cutoff a bounded batch at a time. Each index below serves
-- one of those reads from the tenant, so none reads another tenant's rows.

-- The list, newest activity first, with the id as the tie-break its cursor uses.
CREATE INDEX IF NOT EXISTS assistant_conversations_activity
  ON assistant_conversations (tenant_id, last_active_at DESC, id DESC);

-- Retention finds the conversations idle past the window, never the reported ones.
CREATE INDEX IF NOT EXISTS assistant_conversations_idle
  ON assistant_conversations (tenant_id, last_active_at)
  WHERE reported_at IS NULL;

-- The cap on reported conversations is counted here, not by reading the table.
CREATE INDEX IF NOT EXISTS assistant_conversations_reported
  ON assistant_conversations (tenant_id)
  WHERE reported_at IS NOT NULL;

-- The tool calls of a turn, by tool name: the list reads the names a page of
-- conversations used, and its tool filter asks whether a turn called one, from
-- this index alone and without reading the turn's other events.
CREATE INDEX IF NOT EXISTS assistant_events_tool_calls
  ON assistant_events (tenant_id, turn_id, (payload ->> 'tool'))
  WHERE kind = 'tool_call';

-- Retention takes cards by age.
CREATE INDEX IF NOT EXISTS assistant_approvals_created
  ON assistant_approvals (tenant_id, created_at);
