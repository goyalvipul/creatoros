ALTER TABLE qwen_drafts ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES creative_projects(id) ON DELETE SET NULL;
