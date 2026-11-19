# Notifications build — codebase mechanics notes

> Working notes for the eight implementation tickets cut from spec issue #12 / `docs/specs/notifications.md`.
> This file covers the codebase mechanics the spec assumes. The spec is the source of truth for WHAT is built.

## Branch state

- The build happens on branch `notifications` (= main + spec-lock carry-over commit). Each ticket works in its own worktree/branch based on it.
- This main working tree is on `prototype/notification-surfaces` = main + one prototype commit (untracked prototype component). For all tracked files it matches main unless noted below.
- **Stale untracked junk to IGNORE in this tree**: `app/lib/refund.server.ts`, `app/lib/refund.server.test.ts`, `drizzle/0011_material_stardust.sql`. The real refund domain is `app/lib/refunds.server.ts` (+ `app/lib/refunds.server.test.ts`).
- `GLOSSARY.md` has uncommitted additions (the Notifications section) — the build branch carries that glossary state.

## 1. Domain module convention — what a new module copies from `app/lib/refunds.server.ts`

The pattern (781 lines; header comment lines 27–34):

```ts
export type Db = BetterSQLite3Database<typeof schema>;        // line 35
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];    // line 36
type Queryable = Db | Tx;                                     // line 37
```

- **Every function takes the database first** — `db: Queryable` for reads (tests can pass any db), `db: Db` when the function itself opens the transaction. Positional parameters (project convention), no options object.
- **Result union types**: `export type Failure = { ok: false; status: 400 | 403 | 404 | 409; error: string }` (line 262); success variants `{ ok: true; ...fields } | Failure` (e.g. `RaiseResult` line 353, `DecisionResult` line 571).
- `db.transaction((tx): Result => { ... })` wraps the whole decide path; inner helpers take `tx: Queryable`. Route actions check `result.ok` and return `data(result.error, { status: result.status })`.
- Drizzle style: `.select().from(x).where(...).get() / .all()` (sync better-sqlite3), `alias(users, "deciders")` for self-joins (line 413), `sql<number>`count(*)`` for counts.
- Table row types via `typeof purchases.$inferSelect` (line 39).
- Section banners: `// ─── Section name ───` with a block comment explaining the domain language, pointing at GLOSSARY.md / ADRs.
- Reads happen inside the same transaction before writes; `checkRefundRequest` (line 270) is the reusable eligibility gate.
- Email returned as data today: `type Email = { to: string; subject: string; body: string }` (line 351) — the pipeline build removes this from results.

Test file `app/lib/refunds.server.test.ts` mirrors the module; see §2.

## 2. Test conventions

- Shared helper: `app/test/setup.ts` (only file in `app/test/`). Two exports:
  - `createTestDb()` — `new Database(":memory:")` + `pragma journal_mode = WAL; foreign_keys = ON` + `drizzle(sqlite, { schema })` + `migrate(testDb, { migrationsFolder })` pointing at repo `drizzle/`. **Tests migrate with the real migrations**, so new migrations are automatically applied in tests.
  - `seedBaseData(testDb)` → `{ user (Student), instructor (Instructor), category, course (Published, owned by instructor) }`.
- Pattern in domain tests (`app/lib/refunds.server.test.ts`): `type TestDb = ReturnType<typeof createTestDb>`; module-level `let db`, `let base`; `beforeEach` re-creates db + seeds; local helpers build on it, e.g. `addLearner(name)` (Student user), `buyForSelf(userId, daysAgo = 3, amountPaid = 7900)` (purchase), plus inserts of `modules`, `lessons`, coupons/seats, enrollments, `lessonProgress`. Fixed clock: `const NOW = new Date(2026, 9, 6, 12, 0, 0);` + `daysBefore(n)`.
- Test names are full sentences about domain behavior ("lets the buyer raise one on an Individual Purchase inside the window"), grouped in `describe` per operation.
- `UserRole` values used: `UserRole.Student`, `UserRole.Instructor`, `UserRole.Admin` (Platform Admin).
- Vitest: `vitest.config.ts` — `globals: true`, `tsconfigPaths()` plugin (so `~/` alias works). Run: `npm run test` = `vitest run`.
- Mailer test (`app/lib/mailer.server.test.ts`): create temp outbox with `mkdtempSync(join(tmpdir(), "outbox-"))`, call `sendEmail(msg, outboxTransport(directory))`, then `readdirSync` + `readFileSync` + `JSON.parse` and `expect(written).toMatchObject({ to, subject, body })`. Notification pipeline tests can assert delivered email the same way by injecting the outbox transport into `deliver` (see spec: pipeline is `sendEmail`'s only caller, transport stays injectable).

## 3. Mailer — `app/lib/mailer.server.ts` (72 lines, unchanged by the build)

```ts
export type Email = { to: string; subject: string; body: string };
export interface MailTransport { send(email: Email): Promise<void> }
export function postmarkTransport(serverToken: string): MailTransport
export function outboxTransport(directory: string): MailTransport
export async function sendEmail(email: Email, transport: MailTransport = defaultTransport()): Promise<void>
```

- `FROM_ADDRESS = "Cadence <hello@cadence.dev>"` — single sender, no Reply-To.
- `postmarkTransport`: plain `fetch("https://api.postmarkapp.com/email", ...)` with `X-Postmark-Server-Token` header, `MessageStream: "outbound"`; throws on non-OK.
- `outboxTransport(directory)`: `mkdirSync(recursive)`, writes `{Date.now()}-{to}.json` containing `{ from, to, subject, body }` — this is the ".outbox" behavior.
- `defaultTransport()` reads `process.env.POSTMARK_SERVER_TOKEN` at call time → postmark if set, else `outboxTransport(".outbox")`.
- Pipeline build: mailer keeps its shape; it gains exactly one caller (`deliver`); routes stop importing `sendEmail` (spec invariant #1).

## 4. Refund domain + routes (today's wiring, pre-pipeline)

**`app/lib/refunds.server.ts`:**
- `raiseRefundRequest(db: Db, purchaseId, buyerId, reason, now)` → `RaiseResult` = `{ ok: true; refundRequestId: number; kind: PurchaseKind; email: Email } | Failure` (lines 357–409). **Runs NO `db.transaction` today** — checks via `checkRefundRequest` then one `insert(refunds)` directly on `db`. Route calls `await sendEmail(result.email)` after. The build wraps this in a transaction and emits `refund_request.raised` + `refund_request.received` inside it; the `email`/`kind` fields disappear from the result.
- `approveRefundRequest(db: Db, refundRequestId, platformAdminId, note: string | null, now)` → `DecisionResult` = `{ ok: true; email: Email } | Failure` (lines 614–685). Whole body is `db.transaction((tx): DecisionResult => ...)`.
- `declineRefundRequest(db: Db, refundRequestId, platformAdminId, note: string, now)` → `DecisionResult` (lines 692–733). Empty-trimmed note → 400 before the transaction; then `db.transaction(...)`.
- `buildDecisionEmail(db: Queryable, purchase, decision: RefundStatus.Approved | RefundStatus.Declined, note)` (lines 735–781, private) — builds buyer+course lookups, `noteLines = note ? ["", note] : []`, branch on approved/declined; subject `` `Refund ${decision} — ${courseTitle}` `` (enum values are lowercase `"approved"`/`"declined"`, so rendered "approved"/"declined"). Fallbacks: `course?.title ?? "your course"`, `buyer?.name ?? "there"`, `buyer?.email ?? ""`. Body lines joined with `"\n"`, ends `"— The Cadence team"`. Spec §"refund_request.decided" quotes it verbatim.
- Confirmation render inside `raiseRefundRequest` (lines 394–407): subject `` `Refund requested — ${course.title}` ``, body via array join (spec quotes verbatim).
- **Purchase kind**: `kindOf(seats)` (line 88) — seats = `coupons` rows for the purchase; any seats ⇒ `"team_licence"`, none ⇒ `"individual_purchase"`. Display labels "Individual Purchase" / "Team Licence" are UI strings (`Figures` in admin.refunds.tsx lines 224/232), not enum values.
- **Price**: `formatPrice(purchase.amountPaid)` from `~/lib/utils` (cents; seed uses 7900 = $79).
- **Buyer**: `purchases.userId` → `users` row (name, email).
- **Platform Admins today**: no bulk-admin query exists anywhere. Role check pattern is `currentUser.role !== UserRole.Admin` (admin.refunds.tsx line 67). Recipients fn will need `db.select().from(users).where(eq(users.role, UserRole.Admin))`.

**Call sites:**
- `app/routes/courses.$slug.refund.ts` — action only (no loader/component). Zod via `parseParams`/`parseFormData` (`~/lib/validation`), `getCurrentUserId(request)` (throws `data(..., {status:401})`), calls `raiseRefundRequest(db, purchase.id, currentUserId, parsed.data.reason, new Date())`, `if (!result.ok) throw data(result.error, { status: result.status })`, then `await sendEmail(result.email)` (line 75) and `redirect(result.kind === "team_licence" ? "/team" : "/settings")`. Reason validation: trim, min 10 ("Tell us a little more..."), max 1000.
- `app/routes/admin.refunds.tsx` — `requirePlatformAdmin(request)` helper (lines 56–74: 401 "Select a user from the DevUI panel...", 403 "Only Platform Admins can review refund requests."). Loader: filter `z.nativeEnum(RefundStatus).catch(RefundStatus.Open)` from `?status=`, returns `{ status, refundRequests: listRefundRequestsForReview(db, status, new Date()) }`. Action: `z.discriminatedUnion("intent", [approve, decline])`, calls approve/decline with `platformAdmin.id`, `if (!result.ok) return data({ error: result.error }, { status: result.status })`, then `await sendEmail(result.email)` (line 130), returns `{ success: true, message }`. UI uses `useFetcher` + `toast` (sonner) in `useEffect` on fetcher settle.

(Sections 5–12 below — being filled in.)

# Notifications build — mechanics notes, sections 5–8

## 5. Comment creation (for the prefactor + question.asked birth rule)

### The two `createComment` copies

| | `app/routes/courses.$slug.lessons.$lessonId.tsx` | `app/routes/instructor.questions.tsx` |
|---|---|---|
| fn | `createComment(userId, lessonId, parentId, body)` L404-435 | same signature L118-157 |
| validation | `assertValidBody(body)` helper L330-341 (returns trimmed) | inline L124-132 (same logic) |
| insert | L430-434 | L152-156 |

Both: trim body; `MIN_COMMENT_LENGTH = 1`, `MAX_COMMENT_LENGTH = 5000` (`app/lib/comments.ts:1-2`, shared). Errors thrown as plain `Error`:
- `"Comment cannot be empty"` (< 1 char after trim)
- `` `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer` `` (> 5000)
- `"Lesson not found"` (no course resolves for lessonId)
- `"Parent comment not found"` / `"Parent comment belongs to a different lesson"` / `"Replies can only be one level deep"` (parentId given: parent must exist, share the lesson, and itself be top-level — `parent.parentId !== null` rejects)

Insert (both): `db.insert(comments).values({ userId, lessonId, parentId, body: trimmed }).returning().get()`.

**Differences between the copies** (besides validation being factored into `assertValidBody` in the lesson route):
- Lesson route action (L872-945): parses `createCommentSchema` `{ intent: "create-comment", body: z.string(), parentId: z.coerce.number().int().optional() }` (L68-72); auth via `requireContentAccess(request, course.id)` (L895); returns `{ ok: true }` / `{ ok: false, error }`. Zod failure → `"Enter a comment before posting."`.
- Instructor route action (L188-225): parses `replySchema` `{ intent: "reply", commentId, body }` (L162-166); `parentId` is implicitly the question's own id — it passes `question.id` as parentId (L211-216); auth via `requireStaff(request, course.courseId)` (L208). Zod failure → `"Enter a reply before posting."`. `access.userId!` is passed.
- Both routes also duplicate `getCommentById` and `getCourseForLesson` verbatim (lesson route L311-328; instructor route L99-116). Edit/delete intents in the lesson route additionally scope `existing.lessonId !== lessonId → 404 "Comment not found"` (L919-922, L931-934).
- Catch block (both): `error instanceof Error → { ok: false, error: error.message }`, non-Error rethrown (lesson route L937-944; instructor L217-222). So a shared prefactor can throw plain `Error` and both callers surface the message via toast.

### "Question" definition — instructor queue (`getUnansweredQuestions`, instructor.questions.tsx:42-97)

A queued Question is a comment where ALL hold (L63-70):
- `comments.parentId IS NULL` (top-level) and `comments.deletedAt IS NULL`
- author is **not** Platform Admin: `ne(author.role, UserRole.Admin)` (author = `users` join on `comments.userId`)
- author is **not** the course's instructor: `ne(comments.userId, courses.instructorId)`
- no live staff reply: `notExists(...)` correlated subquery (L48-61) — a `reply` comment with `reply.parentId = comments.id`, `reply.deletedAt IS NULL`, and (`replyAuthor.role = UserRole.Admin` OR `reply.userId = courses.instructorId`)

Join chain (L89-93): `comments → users (author) → lessons (comments.lessonId) → modules (lessons.moduleId) → courses (modules.courseId)`. Instructors see only `eq(courses.instructorId, instructorId)`; admins pass `null` → all courses (L72-74, L176). Order: `desc(comments.createdAt), desc(comments.id)`. Loader auth: `requireInstructorOrAdmin(request)` (L173). Stale badge at `STALE_AFTER_DAYS = 3` (L160).

### `comments` table (`app/db/schema.ts:329-361`)

`comments`: `id` int PK autoincrement; `lessonId` → `lessons.id` notNull; `userId` → `users.id` notNull; `parentId` → self (`(): AnySQLiteColumn => comments.id`, nullable — replies one level deep, enforced on write); `body` text notNull (markdown 1–5000, rendered only via `renderComment`); `createdAt` text ISO notNull `$defaultFn(() => new Date().toISOString())`; `editedAt` nullable; `deletedAt` nullable (soft delete; deleted top-level keeps replies readable). Indexes: `comments_lesson_idx(lessonId)`, `comments_parent_idx(parentId)`.

### Lesson→course and course→instructor resolution

No drizzle `relations()` are defined anywhere — all joins are manual in route queries:
- lesson → course: `lessons.moduleId → modules.id`, `modules.courseId → courses.id` (schema.ts:105-119, 93-103). Canonical resolver: `getCourseForLesson(lessonId)` (both comment routes, returns `{ courseId, courseTitle, courseSlug, instructorId }`).
- course → instructor: `courses.instructorId → users.id` (schema.ts:73-75); e.g. `getCourseWithDetails` joins `users` on `courses.instructorId` (lesson route L129).

## 6. Schema + migrations (for three new tables + one enum)

### `app/db/schema.ts` conventions (376 lines)

- `sqliteTable("snake_case_name", { ... }, (table) => [index(...)/uniqueIndex(...)])` — third arg returns an **array** (L136, L152-154, L321-326, L357-360).
- PKs: `id: integer("id").primaryKey({ autoIncrement: true })`. FKs: `integer("x_id").notNull().references(() => otherTable.id)`; self-FK needs `(): AnySQLiteColumn => comments.id` (L341-343; `AnySQLiteColumn` imported L8). Nullable FK: no `.notNull()` (L251, L292).
- Timestamps: ISO strings — `text("created_at").notNull().$defaultFn(() => new Date().toISOString())`; optional ones plain `text("edited_at")` (L353).
- Enums: plain TS `export enum X` at top (L11-43; `RefundStatus` L34-38, `UserRole` L11-15), applied via `text("status").notNull().$type<RefundStatus>().default(RefundStatus.Open)` (L239-242). No sqlite enum type — column is text, typed/defaulted in TS.
- Booleans: `integer("ppp_enabled", { mode: "boolean" }).notNull().default(true)` (L82-84). Uniques: `.unique()` on the column (L50) or table-level `uniqueIndex("course_ratings_user_course_unique").on(a, b)` (L322-325). Plain indexes: `index("comments_lesson_idx").on(table.lessonId)`.
- No `relations()` anywhere; "enforced on write" rules live as comments on columns.

### Migration flow

- `drizzle.config.ts`: `schema: "./app/db/schema.ts"`, `out: "./drizzle"`, `dialect: "sqlite"`, `dbCredentials.url: "./data.db"`.
- `drizzle/` layout: one numbered sql file per migration (`0000_…` … `0011_volatile_sasquatch.sql`) + `drizzle/meta/NNNN_snapshot.json` per migration and `meta/_journal.json` with `{ idx, version: "6", when, tag, breakpoints: true }` entries.
- `npm run db:generate` (drizzle-kit generate): diffs schema.ts vs latest snapshot → writes `drizzle/00NN_<name>.sql` + `drizzle/meta/00NN_snapshot.json`, appends to `_journal.json`. New tables/enums-as-text need no hand-editing. (Untracked junk `drizzle/0011_material_stardust.sql` has no journal entry — inert; ignore/delete.)
- `npm run db:migrate` (drizzle-kit migrate) applies pending entries to `./data.db`.
- App db (`app/db/index.ts`): lazy singleton `getSqlite()` opens `data.db`, pragmas `journal_mode = WAL`, `foreign_keys = ON`; `db` is a side-effect-free Proxy (keeps better-sqlite3 out of client bundles).
- Tests: shared helper `app/test/setup.ts` — `createTestDb()` = `new Database(":memory:")` (same pragmas) + `drizzle(...)` + `migrate(testDb, { migrationsFolder: "../../drizzle" })` → tests always run the real migrations, so new tables are available in tests once generated. `seedBaseData(testDb)` inserts user/instructor/category/course and returns rows.
- Seed: `scripts/seed.ts` via `npm run db:seed` (`tsx scripts/seed.ts`). Opens `data.db` directly, `sqlite.exec` DROPs **every** table incl. `__drizzle_migrations` (L67-92), then `migrate(db, { migrationsFolder })` recreates from scratch → new tables need no seed change to exist; only add rows if fixture story wants notification data. Seeds 1 admin (Alex Rivera), 3 instructors (Sarah Chen, Marcus Johnson, Priya Nair — owns no courses), 5 named narrative students + generated cohort, categories/courses/modules/lessons/quizzes/enrollments/progress/purchases/refunds/coupons/teams/ratings/comments incl. unanswered-question fixtures. Deterministic PRNG; comments seeded with explicit `createdAt: daysAgo(n)` / `deletedAt`.

## 7. App shell + auth (for the bell, loaders, resource routes)

- `app/root.tsx` (121 lines): global html shell (`Layout`), navigation loading bar, root `ErrorBoundary`. **No loader** — the signed-in user does not reach the UI here.
- `app/routes/layout.app.tsx` loader (L174-217) returns `{ users: [{id,name,role}] (ALL users — for DevUI), currentUser: {id,name,role,avatarUrl} | null, recentCourses, devCountry, countryTierInfo, countries, isTeamAdmin }`. It resolves the user via `getCurrentUserId(request)` + local `getUserById` (not access.server). **Slot for unread count / VAPID public key**: extend this loader's return — it wraps every app page (`app/routes.ts:10-50` nests all app pages under `layout("routes/layout.app.tsx", …)`) — and thread a prop into `Sidebar`.
- Session (`app/lib/session.ts`): cookie session `cadence_session` (dev secret, httpOnly, lax). Exports `getSession`, `getCurrentUserId(request): Promise<number | null>`, `setCurrentUserId(request, userId)` → Set-Cookie string, `destroySession`, `getDevCountry`/`setDevCountry`. Pattern for loaders/actions: `getCurrentUserId` + `getUserById(id)` for the user; role gates via access.server (§8). Session-mutating helpers return a cookie string to attach: `redirect(to, { headers: { "Set-Cookie": cookie } })`.
- Sidebar: `app/components/sidebar.tsx` (287 lines), rendered by layout.app.tsx L232-236 with props `{ currentUser, recentCourses, isTeamAdmin }`. Bottom block (L235-284): dark-mode toggle, then the user row — `UserAvatar` + name/role, the **settings gear = `NavLink to="/settings"` with lucide `Settings` icon (L266-272)**, and a sign-out `Form method="post" action="/api/logout"` (L273-281). Nav items are a static `navItems` array with `roles: UserRole[] | "all"` filtering (L59-120). NOTE: this branch already carries throwaway prototype bells — `PrototypeBellA/B/C` from `~/components/prototype-notifications` gated on `?variant=A|B|C` (L6-11, L129-131, L152-155, L236-239, L262-265); real bell replaces them (wayfinder #10).
- Route registration: config-based `app/routes.ts` (`satisfies RouteConfig`), flat file list. `api/*` routes sit at top level **outside** the app layout (L53-56). After adding routes, `npm run typecheck` regenerates `./+types/*` via `react-router typegen`.
- Resource-route conventions (`app/routes/api.*.ts`, no default export):
  - `api.switch-user.ts`: `action({ request, url })` → `request.formData()` + `parseFormData(formData, zod)` → `setCurrentUserId` → `redirect(url.searchParams.get("redirectTo") ?? "/", { headers: { "Set-Cookie": cookie } })`.
  - `api.video-tracking.ts`: `action` → `getCurrentUserId` (401 via `throw data("Unauthorized", { status: 401 })`) → `await parseJsonBody(request, schema)` from `~/lib/validation` → insert → plain object `{ success: true }` (auto-JSON). This is the JSON-body pattern a push-subscription route would copy.
  - `api.logout.ts`: `action` → `destroySession` → redirect with Set-Cookie. No GET/DELETE method switching anywhere — everything is POST actions.
- `app/routes/settings.tsx` (328 lines, inside app layout): loader L38 (current user + refund requests), action L71 parses `settingsSchema` (zod, L26), toasts success/error client-side (L118-122). Two sections: "Profile" (h2 L146, name/email form → own action) and "Refund Requests" (h2 L210). A notifications-preferences section slots between them.
- DevUI (`app/components/dev-ui.tsx`): floating bottom-right panel. `Switch user` = per-user `<Form method="post" action={"/api/switch-user?redirectTo=" + current path}>` with hidden `userId` (L109-131); PPP country select posts `/api/set-dev-country`. Users/`currentUser` props come from the layout.app loader — this is the manual-testing user switch for the bell.

## 8. Roles + access

- `UserRole` (`app/db/schema.ts:11-15`): `Student = "student"`, `Instructor = "instructor"`, `Admin = "admin"` — text column `users.role` (L51). "Platform Admin" in copy = `UserRole.Admin`.
- `app/lib/access.server.ts` (202 lines) exports exactly: `type Access` (L54-71: `userId, user, isAdmin, isOwningInstructor, isStaff, enrolled, pppBlocked, pppBlockedCountry, pppPurchaseCountry, canViewContent`), `getAccess(request, courseId)` (never throws; signed-out returns the `SIGNED_OUT` constant, L73-91), `requireUserId(request)` (401 `"Select a user from the DevUI panel."`, L137-143), `requireContentAccess(request, courseId)` (401/403 `"You must be enrolled in this course."`, L149-164), `requireStaff(request, courseId)` (403 `"Only this course's instructor can do that."` unless owning instructor or admin, L169-184), `requireInstructorOrAdmin(request)` → `{ userId, user, isAdmin }` (L190-202, 403 `"Only instructors can access this page."`). Positional params are project convention.
- How loaders/actions check roles today:
  - Loader gate, any-course: `instructor.questions.tsx:173` — `const { userId, isAdmin } = await requireInstructorOrAdmin(request);` then `getUnansweredQuestions(isAdmin ? null : userId)` (L176) — Admin is platform-wide, Instructor is scoped by `courses.instructorId`.
  - Action gate, course-scoped staff: `instructor.questions.tsx:208` — `requireStaff(request, course.courseId)` before posting a reply.
  - Action gate, content: `courses.$slug.lessons.$lessonId.tsx:895` — `requireContentAccess(request, course.id)` for comment intents, with the comment at L888-889: "loader guards don't protect actions".
  - Owning-instructor test lives in `getAccess` (access.server.ts:98): `isOwningInstructor = course?.instructorId === userId`; `isStaff = isAdmin || isOwningInstructor` (L99); `canViewContent = isStaff || (enrolled && !ppp.blocked)` (L130).

# Notifications build — sections 9–12

Expanded build notes for the notification-surface work on branch `prototype/notification-surfaces`. Sections 9, 10, and 12 expand gathered findings (plus `AGENTS.md` / `CODING_STANDARDS.md` read directly); section 11 digests the prototype and the research doc. Every path and line ref is exact. Ignore stale untracked `app/lib/refund.server.*` and `drizzle/0011_material_stardust.sql`.

## 9. UI conventions (for the bell popover, settings cards, pre-prompt)

- **Existing primitives.** `app/components/ui/` contains exactly eight files: `button.tsx`, `card.tsx`, `chart.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `skeleton.tsx`, `tabs.tsx`. All are shadcn-style: `cva` variant definitions, `data-slot` attributes, Radix re-exports.
- **Missing primitives.** No `dialog`, `popover`, `dropdown`, or `switch` primitive exists. The build must add those shadcn primitives or hand-roll the markup; hand-rolling has precedent — the prototype builds its own `CheapSwitch` at `app/components/prototype-notifications.tsx:178`.
- **Composition.** The bell popover, the settings toggle rows, and the in-app pre-prompt (the pitch shown before the native permission dialog) all build on the existing `Button` / `Card` plus custom markup. Working example of the card + button conventions in a real route: `app/routes/settings.tsx`.
- **Icons.** `lucide-react` via plain named imports (`import { Bell } from "lucide-react"`). There is no `IconName` mapping type anywhere in the repo — do not invent one.
- **Relative time.** No helper exists in app code. Only precedent: the prototype's `relTime(minutesAgo)` (returns values suffixed `m` / `h` / `d` / `w`). Port or generalize it for "5m ago" strings in bell rows.
- **Styling.** `app/app.css` is Tailwind v4 with `@custom-variant dark` and shadcn tokens. Dark mode: an inline script reads `localStorage 'cadence-theme'` and toggles the `.dark` class (see `app/root.tsx`). Use token classes, not raw palette colors.
- **Unread vs read.** Established pattern: unread rows get tint `bg-primary/5` plus an unread dot; read rows dim via `text-muted-foreground`.
- **Static assets.** `public/` holds only `favicon.svg` and `images/` — no web app manifest, no service worker today. Push needs both: a manifest with `display: standalone` and a service worker handling `push` / `notificationclick`.
- **Toasts.** sonner. `<Toaster position="bottom-right" richColors closeButton />` at `app/routes/layout.app.tsx:247`; call sites use `toast.success` / `toast.error` / `toast.info` (see `app/routes/settings.tsx`). Use these for pre-prompt and subscription-flow feedback.

## 10. Env handling (for APP_URL + VAPID keys)

- **No env infrastructure.** No `.env.example`, no zod env-parsing module. Env vars are read inline at the point of use; two precedents govern the new vars:
- **Precedent 1 — optional key with dev fallback.** `process.env.POSTMARK_SERVER_TOKEN` is read at `app/lib/mailer.server.ts:63`. When unset, the mailer falls back to `outboxTransport(".outbox")`, which writes outgoing messages as JSON files for dev/tests. Mirror this for a `webPushTransport`: read VAPID keys server-side; when missing, fall back to a no-op transport rather than crash.
- **Precedent 2 — optional value surfaced to the UI.** `process.env.DISCORD_INVITE_URL || null` at `app/routes/courses.$slug.welcome.tsx:121` — plain `|| null`, no validation layer.
- **VAPID keys.** Generate once with `web-push`'s `generateVAPIDKeys()`; store public + private in env next to `POSTMARK_SERVER_TOKEN`. Nothing validates their presence today — follow the mailer convention (missing keys ⇒ dev no-op transport).
- **APP_URL.** Needed for the VAPID `mailto:` subject and any absolute links in notifications. Same approach: read where used, dev fallback, no new global env module.
- **Server → client.** `app/root.tsx` has NO loader. The pattern to copy is `app/routes/layout.app.tsx`: a loader returning a plain object, consumed by the component via `Route.ComponentProps` `loaderData`. Expose the VAPID public key (and `APP_URL` if needed) through that loader; the client then subscribes with it as `applicationServerKey`.

## 11. Prototype + research digests (reference material)

### Part A — prototype digest

Source: `git show prototype/notification-surfaces:app/components/prototype-notifications.tsx` (945 lines).

- **Demo data (lines 45–131).** Notification catalog / delivery matrix: per-event channels (in-app, email, push) plus "always sent" rows.
- **`PrototypeBellB` (lines 363–465).** Icon-only bell in the sidebar user row. Floating badge over the bell shows the unread count, capped at "9+". Popover header: title + unread count + "Mark all read". Rows: a `RowIcon`, line 1 (title + `relTime`), line 2 (body), an unread dot, unread tint `bg-primary/5` vs read dim. `BellEmpty` empty state doubles as the push pitch with a "Turn on push notifications" stub. Footer: "Manage preferences" link.
- **`SettingsB` (lines 683–757).** Stacked per-event cards, each with three `CheapSwitch` columns (In-app / Email / Push); a boxed dashed "Always sent" group underneath; a `DeviceSim` block simulating per-device subscription state.
- **NOTE.** The prototype's popover / switch / badge chrome is throwaway — the build picks its own primitives and keeps only the structure and behaviors above.

### Part B — push research digest

Source: `docs/research/push-to-phone-delivery.md` (branch `research/push-to-phone-delivery`, 124 lines, revised 2026-11-17). Recommendation: raw Web Push via the `web-push` npm package — free at every volume, subscriptions stay in our schema; a hosted sender (OneSignal, free ≤ 10k subscribers) can be added later for campaign-grade sends. What implementers of the push tickets need:

- **`web-push` API.** `generateVAPIDKeys()` (one-time), `setVapidDetails(mailto, publicKey, privateKey)`, `sendNotification(subscription, payload)` with TTL / urgency / topic options (TTL lets the push service queue while the device is offline). Failed sends surface as `WebPushError` carrying the HTTP status — a 404 or 410 means the subscription is gone: delete the stored row.
- **VAPID.** RFC 8292 server key pair; the subject is a `mailto:`. Keep keys in env next to `POSTMARK_SERVER_TOKEN` and mirror the `MailTransport` abstraction in `app/lib/mailer.server.ts` (`Email`, `interface MailTransport`, `sendEmail(...)`) with a dev/test no-op transport.
- **Subscription shape (`PushSubscription`).** `endpoint` (a secret capability URL on the browser vendor's push service — store it unique), `keys.p256dh`, `keys.auth`, `expirationTime` (epoch ms). Upsert on `pushsubscriptionchange`.
- **Service worker APIs.** `push` event → `showNotification()`; `notificationclick` for focus/navigation; `pushsubscriptionchange` fires on expiry/invalidation → resubscribe and upsert server-side. Client side: `registration.pushManager.subscribe({ applicationServerKey })` and `getSubscription()`.
- **Permission flow.** `Notification.requestPermission()` from a user gesture; on iOS, `subscribe()` must be called immediately inside the gesture's event handler. Plan an in-app pre-prompt before the native dialog.
- **iOS Safari requirement.** iOS 16.4+ delivers Web Push only to web apps added to the Home Screen, via a manifest with `display: standalone` or `fullscreen` (macOS Safari 16+ needs no install). Rides `*.push.apple.com` — no Apple Developer Program membership needed. No silent push: Safari revokes permission if a received notification is not shown immediately. The Badging API works.
- **Gotchas the doc records.** The VAPID subject must not be `localhost` — Apple rejects it with `BadJwtToken`. iOS shows no permission prompt until the Home Screen install exists. OneSignal's free plan purges subscriptions dormant > 18 months; Pusher Beams cannot reach iPhone Safari at all (both moot while staying raw). Open questions left to the build: service-worker + manifest registration strategy under React Router 8.3 framework mode, and whether to adopt the Badging API for app-icon badges.

## 12. Gotchas + repo rules

- **Verification order (`AGENTS.md`)** — run both, in this order, before reporting any change to `app/` as complete:
  1. `npm run typecheck`
  2. `npm run test`
- **Typegen.** `npm run typecheck` runs `react-router typegen` first. If `tsc` reports every `./+types/*` import missing, typegen hasn't run — use `npm run typecheck`.
- **Dev auth.** A 401 "Select a user from the DevUI panel" means no user in the session — switch users and country in the floating panel (`app/components/dev-ui.tsx`).
- **Issue tracker.** Issues and PRDs live as GitHub issues on your own copy of this repo (the `origin` remote), never on `ai-hero-dev/cohort-005-project`, managed with the `gh` CLI; see `docs/agents/issue-tracker.md`.
- **`CODING_STANDARDS.md` (25 lines) — rules captured verbatim:**
  - Throw, don't return: "A loader or an action that cannot continue throws. It does not return an error shape for the component to unpack." (`throw data("Course not found", { status: 404 })`)
  - Zod all input: "Form data, search parameters and request bodies get a zod schema before the values reach any query. Do not read `formData.get("x") as string`. The cast is a lie the type checker believes."
  - "Do not write `any`, and do not write `!`" — "Both switch the type checker off at the exact point you are least sure. If a value can be missing, narrow it with a check. If you cannot name the type, the shape is wrong — fix the shape."
- **Commits.** Style is `slug: message` (verified in git log).
- **Tests.** vitest with `globals: true` and the tsconfig-paths plugin.
- **Database.** App DB is a lazy better-sqlite3 proxy in `app/db/index.ts`.
- **Server-only code.** `*.server.ts` files never reach the client bundle — keep `web-push` imports and env reads in them.
