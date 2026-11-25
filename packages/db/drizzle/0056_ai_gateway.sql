CREATE TABLE ai_gateway_connections (
 org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 mode text NOT NULL DEFAULT 'hosted' CHECK (mode IN ('local','hosted')),
 scopes text[] NOT NULL DEFAULT ARRAY['projects.read','media.read']::text[],
 local_hash text UNIQUE, hosted_hash text UNIQUE,
 local_owner uuid REFERENCES users(id) ON DELETE SET NULL,
 hosted_owner uuid REFERENCES users(id) ON DELETE SET NULL,
 local_seen timestamptz, hosted_seen timestamptz
);
