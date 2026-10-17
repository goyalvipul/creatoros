# Todo adapter contract

Creator OS can send its own action items (from the Today queue) to your self-hosted Todo PWA. Your Todo app's real API is not
known to Creator OS in advance, so the adapter is **configuration, not code**: endpoint paths, field names, priority values and
the way completion is represented are all settable in _Integrations → Todo_. The defaults below are what a Todo app has to
expose if you would rather add endpoints to Todo than configure the adapter. A machine-readable version is in
[`openapi/todo-adapter.yaml`](../openapi/todo-adapter.yaml).

## What Creator OS needs

| Need                         | Default endpoint                 | Notes                                                                                                                       |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Create a task                | `POST /tasks`                    | Sends `Idempotency-Key: creatoros:<orgId>:<actionId>`. The same key must return the same task, never a second one.          |
| Find a task by our reference | `GET /tasks?external_ref={ref}`  | Used before every create, so a lost response or a retry can never duplicate a task. `ref` is `creatoros:action:<actionId>`. |
| Read one task                | `GET /tasks/{id}`                | Reads completion, due date and revision.                                                                                    |
| Update a task                | `PATCH /tasks/{id}`              | Only changed fields are sent. Sends `If-Match: <revision>`; answer `412` if the revision is stale.                          |
| List changed tasks           | `GET /tasks?updated_since=<iso>` | Incremental reconciliation (every 5 minutes, full pass every 30).                                                           |
| Health (optional)            | `GET /health`                    | If absent, Creator OS falls back to listing one page of tasks.                                                              |

Default field names (all configurable): `id`, `title`, `description`, `due_at` (ISO-8601), `timezone`, `priority`, `completed`
(boolean, or a status string when configured with `completion.style = status`), `completed_at`, `updated_at` (used as the revision /
ETag), `external_ref`, `project_id`, `tags`, `remind_at`. Dotted paths such as `meta.ref` are allowed. Responses may be the object itself or wrapped in
`data`, and lists may be a bare array or wrapped in `data`, `items`, or `tasks`.

Authentication: `Authorization: Bearer <token>` by default, or a custom header (`authScheme: header`, `authHeader: x-api-key`), or none for
a private network. Use a token created in the Todo app; never share its database.

## Ownership and conflict policy (`TODO_OWNS_DUE_AND_COMPLETION`)

- Creator OS owns the **title, description and priority** of the tasks it creates.
- Todo owns **due date and completion**. If you tick a task in Todo, the Creator OS action is completed on the next reconciliation. If you move the
  due date in Todo, Creator OS adopts it. Unrelated Creator OS fields are never overwritten (tested: T25).
- A Creator OS edit is pushed with `If-Match`. If the task changed in Todo in the meantime, the link becomes a visible **CONFLICT** that you resolve; nothing is overwritten silently.

## Sync states you will see

`PENDING` (queued, or Todo is offline: never shown as synced) → `SYNCED` → `CONFLICT` (needs you) or `DEAD_LETTER` (failed 8 times; see the error, fix Todo, press
_Retry_). A task is only created after the connection test passes, and "Send to Todo" is hidden on Today until then.

## Setup steps

1. In the Todo app, find its API base URL and create an API token.
2. _Integrations → Todo_: enter the base URL and token, adjust endpoint paths and field names if they differ, press **Test connection**.
3. On _Today_, use **Send to Todo** on an action. It is idempotent: pressing it twice never creates two tasks.

When the real API is known, only the configuration needs to change. If Todo cannot offer `external_ref` lookup or `Idempotency-Key`, ask for those two
features first: they are what make retries safe.
