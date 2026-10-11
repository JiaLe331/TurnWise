# Restaurant Table Operations

## *Product Requirements Document*

AI Builder Cup  |  Retail and Commerce track  |  10 October 2026  |  Version 1.0

# **Product decision**

We will build an AI operations assistant for casual-dining restaurants that turns existing CCTV views into a live table board, clearing priorities, and seating recommendations. The MVP will help hosts and floor staff reduce avoidable time between a party leaving and the next party being seated.

This PRD defines the MVP behavior, engineering boundaries, evaluation plan, and business proposition. The audience is the product and engineering team building the competition demo and the restaurant manager evaluating a pilot.

## **Problem statement**

During a busy service, hosts and floor staff must notice departures, communicate which tables need clearing, confirm that cleaning is complete, and match available tables to waiting parties. When these steps depend on repeated floor checks and verbal updates, a waiting party may remain unseated while a suitable table is idle or awaiting attention.

Our problem hypothesis is that missed handoffs and poor visibility create a meaningful share of this delay. Restaurant observation and a baseline pilot must establish its size before we claim an improvement.

## **Desired outcome**

* Give the host one current view of occupancy, clearing work, and tables confirmed ready for seating.  
* Help floor staff act on the clearing task that can serve the next eligible waiting party.  
* Measure departure-to-ready time, ready-to-seated time, and queue waiting time so managers can assess the effect.

## **Scope and assumptions**

The agreed direction is casual dining, table-state detection, and clearing and seating recommendations. This PRD proposes a one-outlet MVP with 8 to 20 mapped tables and 1 to 2 fixed cameras. These limits, all numeric targets, the delivery sequence, and the commercial model are planning assumptions to validate.

The restaurant must have usable camera views, a host-managed queue, staff able to confirm departure and readiness, and a device at the host station. Camera coverage must show chairs and enough of each tabletop to support observations. Tables without adequate coverage remain manually managed.

# **Users and feature priorities**

| User | Need | Primary action |
| :---- | :---- | :---- |
| Host | Know which suitable table can seat the next party. | Manage the queue and accept a seating recommendation. |
| Floor staff | See which table needs attention next. | Verify departure, claim clearing work, and confirm readiness. |
| Manager | Understand delays and correct exceptions. | Review shift metrics, overrides, and camera health. |

## **User stories**

* As a host, I want a table recommendation with its capacity and readiness evidence so I can seat a waiting party confidently.  
* As a floor staff member, I want one clearing queue with priorities and ownership so I do not miss a task or duplicate another person's work.  
* As a manager, I want timestamps for each handoff so I can identify whether delays occur before clearing, during cleaning, or after a table is ready.

## **MVP priority matrix**

P0 is required for the core demo and pilot workflow. P1 follows after the workflow passes validation. P2 is a later expansion.

| Priority | Capability | Reason |
| :---: | :---- | :---- |
| P0 | Camera mapping and live table board | Provide usable observations tied to real table IDs. |
| P0 | Occupancy and departure review | Trigger the handoff without releasing an active party's table. |
| P0 | Clearing queue and ready confirmation | Turn observations into work that staff can complete. |
| P0 | Manual waitlist and seating rules | Connect available capacity to actual waiting demand. |
| P0 | Overrides, freshness, audit events | Keep staff in control and prevent invalid assignments. |
| P0 | Basic shift metrics and export | Measure the workflow and support the competition demo. |
| P1 | Shift summaries and staff routing | Explain patterns and distribute work across larger teams. |
| P2 | POS, reservations, forecasts, chains | Expand after the single-outlet workflow is reliable. |

## **Outside the MVP**

Exclude facial recognition, customer identification, emotion inference, individual employee scoring, payment or order automation, autonomous seating, exact meal-stage detection, guaranteed wait-time predictions, and automated hygiene certification. Table joining and reservation-system integration are deferred; the manager can block tables manually.

# **Table states and service workflow**

The system keeps visual observations separate from operational state. A camera can suggest that seats are empty or objects remain. Staff determine whether a party has departed and whether a table is ready to serve.

| State | Meaning | Allowed next action |
| :---- | :---- | :---- |
| Occupied | An active party owns the table, including temporary absences. | Suggest departure review after sustained vacancy. |
| Departure review | Seats appear vacant but the party has not been released. | Staff confirm departure or keep the party active. |
| Needs clearing | Staff confirmed departure; reset is required. | Create or prioritize one clearing task. |
| Cleaning | A staff member has started the clearing task. | Staff complete the task and confirm readiness. |
| Ready | Staff confirmed the table is reset and available. | Recommend it if eligibility and freshness checks pass. |
| Unknown | Current visual evidence is missing or unreliable. | Verify manually; exclude automatic recommendations. |

Blocked and seating hold are availability overlays. A blocked table stays out of recommendations regardless of its state. A seating hold reserves a ready table for one waiting party for 60 seconds. Unknown is an observation-quality condition that preserves the last operational state and active party ID.

## **State transition rules**

* Initial setup requires staff to set the operational state. A camera never initializes a table as ready.  
* Consistent vacancy evidence over at least 30 seconds, with at least three observations, may suggest departure review. Belongings, occlusion, or contradictory evidence mark the review uncertain.  
* Staff confirm departure to enter needs clearing. Starting a claimed task enters cleaning; an explicit ready confirmation completes it.  
* Accepting a seating recommendation creates a hold. The host marks the party seated to enter occupied. A hold expires or can be cancelled if seating does not occur.  
* New occupancy evidence on a ready table or hold pauses eligibility and requests verification. A manual occupied state persists until staff release it.

## **Example service journey**

A party of four joins the queue. Table 6, which seats four, appears vacant for 30 seconds. The board asks staff to verify departure. Staff confirm that the previous party has left, and the clearing queue raises Table 6 because it can serve the oldest eligible waiting party. Staff claim the task, clean the table, and tap Ready. The host sees Table 6 as a recommendation with its capacity and confirmation time, accepts it, and marks the party seated.

If guests return during departure review, the table stays occupied and no clearing task is created. If the camera fails, the board shows the last update and permits a clearly labelled manual workflow.

# **Detection and clearing requirements**

## **FR01 Map cameras to tables**

A manager registers a camera, draws a region for each table and its seats, and enters table ID, capacity, zone, and optional accessibility attributes. One configured camera is authoritative for each table in the MVP.

**Acceptance**  Every observation resolves to an existing outlet and table. Incomplete or obstructed mappings are flagged and remain manual. Moving a camera requires recalibration before recommendations resume.

## **FR02 Generate visual observations**

The gateway samples frames and submits cropped or masked regions. The model returns occupied, vacant, or unclear, plus visible leftover objects, occlusion flags, evidence time, and a short reason. A valid response remains an observation, not a seating authorization.

**Acceptance**  Test footage updates the correct table. Invalid responses, failed calls, and poor visibility produce unclear without inventing a state. Stored model and prompt versions identify how an observation was produced.

## **FR03 Suggest departure review**

Use time consistency and session ownership to suggest a departure review after vacancy persists. Default sampling is every 10 seconds; the proposed vacancy interval is 30 seconds. A single empty frame cannot release a party.

**Acceptance**  Temporary absence, a person passing nearby, and a brief occlusion do not create clearing work. Confirming departure releases the active party and creates one task; dismissing review restores occupied.

## **FR04 Manage clearing work**

Show table ID, reset age, zone, capacity, task owner, and why it is prioritized. Rank tasks that serve the oldest compatible waiting party first; use departure age to break ties. If no party can be served, prioritize the oldest task.

**Acceptance**  Repeated observations create no duplicate task for the same table cycle. Two staff members claiming at once result in one owner. Tasks have unassigned, claimed, started, completed, and cancelled statuses.

## **FR05 Confirm readiness and handle exceptions**

Floor staff explicitly confirm that clearing and setup are complete. Managers can correct a state, block a table, or reassign a task with a reason. In-app alerts are grouped by table and task so repeated frames do not repeat notifications.

**Acceptance**  Ready cannot be set by the model. Completion records actor and time. Occupancy evidence on a ready table pauses seating and raises one verification alert. A manual occupied correction remains effective until staff release it.

For the competition demo, staff actions may be performed on one shared tablet using separate role accounts. Push notifications and automated staff dispatch are P1.

# **Seating and interface requirements**

## **FR06 Maintain a minimal waitlist**

The host adds a party using an anonymous queue code, party size, arrival time, and any declared seating requirement. Parties can be waiting, on hold, seated, cancelled, or left. Names and phone numbers are unnecessary for the MVP.

**Acceptance**  Queue order is stable by arrival time. Every change records an actor and timestamp. Cancelling or editing a party releases or revalidates its hold.

## **FR07 Recommend an eligible table**

Apply hard constraints first: ready state, no active party, no block or conflicting hold, sufficient capacity, required attributes, and current evidence or a valid manual verification. Choose the oldest party that currently has an eligible table, then the smallest suitable table; use longest ready age and table ID as tie breakers.

**Acceptance**  Return up to three eligible tables with a plain-language reason. If none exist, say so without offering an occupied or dirty table. Queue skips caused by capacity are visible; a host override requires a recorded reason.

## **FR08 Accept seating without conflicts**

Acceptance creates an atomic 60-second hold on both party and table. Recheck state and versions on acceptance and when marking seated. Host confirmation starts the new occupied session. Expired holds return the party to its original queue position.

**Acceptance**  Concurrent host requests cannot assign the same table or party twice. A stale recommendation is rejected with a clear conflict error and refreshed. Unexpected occupancy or a state correction invalidates the hold and requests host verification.

## **FR09 Provide a usable live board**

The host view shows a floor map or table grid alongside the waitlist. The staff view shows clearing tasks and large Claim, Start, and Ready actions. Managers see shift totals, exceptions, and camera health. Each table shows status text, last observation time, and manual-state markers.

**Acceptance**  Color is supported by labels and icons. A staff action takes at most two taps after selecting a task. Tablet and phone layouts show every required action without horizontal scrolling. Live and recorded-demo modes are labelled.

## **FR10 Support degraded service**

After 60 seconds without a valid observation, mark visual status unknown and exclude the table from automatic recommendations. Hosts can directly assign after a documented physical check. The assignment is labelled manual and remains subject to ownership and capacity checks.

**Acceptance**  A disconnected board never presents cached status as current. Offline actions do not silently claim a table; show that synchronization is unavailable. On recovery, reconcile current state before processing recommendations.

# **Technical architecture**

The proposed stack uses Google Cloud for image interpretation, application services, and event analytics. A restaurant-side gateway reads the local camera feed. Cloud Run handles bounded HTTP requests; it is not the permanent reader of a CCTV stream. Google documents request timeouts and Pub/Sub integration for Cloud Run \[3, 4\].

| Component | Proposed responsibility |
| :---- | :---- |
| CCTV and local gateway | Read permitted RTSP or recorded input; sample, crop, mask, timestamp, and upload selected frames over HTTPS. |
| Cloud Run API and worker | Authenticate users and gateway; validate observations; run state, task, and seating rules; expose application APIs. |
| Gemini on Vertex AI | Interpret table regions using image input and a structured response schema \[1, 2\]. Pin a supported model version after benchmarking. |
| Firestore | Store current table state, sessions, tasks, queue, and holds. Use listeners for live views and transactions for competing assignments \[5, 6\]. |
| Pub/Sub | Deliver observation work to the worker and fan out validated events. Keep image bytes out of messages; process retries idempotently \[3\]. |
| BigQuery | Query timestamped operational events for shift metrics. Keep analytics off the critical seating path \[7\]. |
| Private Cloud Storage | Transient masked frames for queued inference, deleted after processing; optional pilot evidence under restricted access. Full video stays on site. |
| Identity and monitoring | User login, outlet-scoped authorization, service identity, secrets, error logs, health and cost monitoring. |

## **Processing sequence**

* The gateway crops and masks table regions, records observed\_at, and submits a frame ID and configuration version.  
* The API accepts the frame and queues work. The worker calls Gemini, validates the response, and rejects late or invalid observations.  
* State rules update Firestore and create a durable audit event in the same transaction. The event publisher retries from this record so analytics events are recoverable.  
* The board receives live state updates. Staff actions and accepted seating recommendations pass through the API and transactional rules.  
* A deduplicating analytics writer sends committed events to BigQuery. A delayed analytics write does not block a staff action.

## **AI boundary and cost control**

Gemini interprets images; deterministic code selects tasks and eligible tables. The MVP uses table-region batches from sampled frames. Begin with a 10-second cadence, then test change-triggered calls and a 30-second heartbeat. Enforce per-outlet call limits, retry limits, and a daily cost ceiling. Model self-reported confidence is not treated as a calibrated probability. A specialist detector is a later option if benchmarks show that latency or cost requires it.

# **Data and integration contracts**

| Entity | Required fields |
| :---- | :---- |
| Outlet and table | outlet\_id, table\_id, capacity, zone, attributes, camera\_id, region, configuration\_version, blocked |
| Observation | observation\_id, frame\_id, table\_id, observed\_at, received\_at, visual\_status, object\_flags, occlusion, model\_version, prompt\_version |
| Table session | session\_id, table\_id, party\_id, operational\_state, state\_version, last\_valid\_observation\_at, seated\_at, departed\_at, ready\_at |
| Task | task\_id, session\_id, table\_id, status, priority\_reason, owner\_id, created\_at, started\_at, completed\_at |
| Queue party and hold | party\_id, queue\_code, size, arrival\_at, requirements, status; hold\_id, table\_id, expires\_at, version |
| Audit event | event\_id, outlet\_id, table\_id or party\_id, session\_id when relevant, event\_type, event\_time, received\_at, actor\_type, actor\_id, source, reason |

## **Events and consistency**

Record party\_arrived, departure\_review\_requested, departure\_confirmed, task\_claimed, cleaning\_started, ready\_confirmed, seating\_hold\_created, seating\_hold\_expired, party\_seated, party\_left, state\_overridden, and camera\_stale. Store timestamps in UTC and display local outlet time. Preserve source and actor so observed, confirmed, and inferred times remain distinguishable.

Every mutation uses an idempotency key. Observations include a monotonic gateway sequence and configuration version; an older sequence or incompatible map cannot overwrite newer evidence. State updates, task changes, party status, and holds use transactions with expected versions. Firestore is the operational source of truth; BigQuery deduplicates on event\_id.

## **MVP API surface**

| Method and route | Purpose |
| :---- | :---- |
| POST /observations | Accept authorized gateway frames and metadata. |
| GET /outlets/{id}/board | Return current tables, freshness, and task summaries. |
| POST /tables/{id}/actions | Confirm departure or readiness; correct or block state. |
| POST /tasks/{id}/actions | Claim, start, release, complete, or cancel work. |
| POST /parties | Create an anonymous waitlist entry; update through party actions. |
| GET /recommendations | Return eligible tables for the next compatible party. |
| POST /seating-holds | Create, cancel, or confirm a hold with version checks. |
| GET /outlets/{id}/metrics | Return dated shift metrics and a CSV export. |

# **Quality and privacy requirements**

## **Performance and reliability**

* Proposed end-to-end target: a board update within 15 seconds at the 95th percentile from frame capture, under the specified 20-table and 2-camera load. Departure review still requires its separate 30-second persistence interval.  
* Committed staff actions should appear within 2 seconds at the 95th percentile. Recommendation computation should take under 1 second, excluding network delay. Measure these targets in the pilot environment.  
* Mark observations older than 60 seconds as stale. Timeout and invalid-response paths preserve active sessions, suppress recommendations, and show a verification action.  
* Retry transient errors with bounded backoff. Deduplicate frames, tasks, holds, and events. Recovery must not replay an earlier observation into a current party session.  
* Target 99 percent measured application availability during pilot service hours. Track camera, gateway, internet, API, and model failures separately to expose the actual source of interruption.

## **Privacy and access**

Process only the table and seat regions needed for the workflow. Mask faces and unrelated areas locally before upload; reject an input when required masking cannot be applied. Do not record audio or use biometrics, customer identity, or employee identity from camera imagery.

Delete transient frames after processing, with a 10-minute maximum buffer lifetime for retries. Default to no retained evidence images. For a consenting pilot, permit masked evidence with a maximum 24-hour retention and verified deletion. Retain operational metadata for 90 days, then delete or aggregate it. These are proposed defaults; settle notice, permissions, retention, and processing arrangements before using real footage.

Require authenticated access and outlet-scoped roles. Hosts manage parties and seating; floor staff handle tasks and readiness; managers configure cameras, inspect evidence, and apply overrides. Enforce permissions in the API and live-data read rules. Keep camera credentials in the gateway or managed secrets, never in the client or logs.

## **Model evaluation**

Use consented footage or staged recordings with human labels for occupancy, vacancy, leftover objects, and occlusion. Split training or prompt-tuning footage from the final evaluation by recording session. Include shadows, staff passing, temporary absence, plates remaining, personal belongings, camera loss, and different table layouts.

Proposed minimum evaluation set: 100 complete table cycles across at least 5 recording sessions. Report occupancy precision and recall, vacancy and departure-review precision and recall, per-class counts, and detection delays. Exclude unclear samples from accuracy only when their rate and reasons are also reported. A staged demo proves functionality; it does not establish restaurant-wide performance.

# **Success metrics and pilot plan**

All targets below are hypotheses for a pilot, not achieved results. The primary outcome is faster departure-to-ready time during comparable periods with waiting demand, while preserving correct table ownership and seating eligibility.

| Metric | Definition | Proposed target |
| :---- | :---- | :---- |
| Departure to ready | ready\_at minus independently observed final departure time; report median and P90. | 20 percent lower median against baseline. |
| Ready to seated | seated\_at minus ready\_at when a compatible party is waiting. | 20 percent lower median against baseline. |
| Queue wait | seated\_at minus arrival\_at; report median and P90 by party size. | Improve without worsening P90 by over 10 percent. |
| Occupied precision and recall | Correct occupied observations against labels; report both. | At least 95 percent precision and 90 percent recall. |
| Departure review precision | True final departures among prompted reviews. | At least 90 percent; report missed departures separately. |
| Incorrect recommendation | Accepted recommendations violating ownership, readiness, hold, or capacity rules. | Zero in scripted tests and pilot log review. |
| Correction and adoption | Overridden inferred transitions; completed tasks and seating decisions using the workflow. | Corrections under 10 percent; use on at least 80 percent of eligible cycles. |

## **Measurement rules**

Use observer-labelled final departure for the primary metric because staff confirmation can occur later. If unavailable, label the measure confirmed-departure-to-ready and report the confirmation delay separately. Compare only fully observed cycles within service hours. Report missing timestamps, censored cycles, unclear frames, sample sizes, and overrides. Do not treat reduced ready time as evidence of revenue growth.

## **Pilot design**

* Baseline: observe 3 comparable service shifts without prompts and capture departure, clearing, ready, seating, party size, waiting demand, and staffing.  
* Shadow mode: run the camera workflow without operational prompts for 2 shifts. Check mapping, missed events, nuisance alerts, and privacy controls.  
* Assisted mode: run 5 comparable shifts with staff confirmation and host acceptance. Where feasible, alternate comparable assisted and baseline shifts to reduce day and learning effects.  
* Review: compare by shift, zone, party size, staffing, and demand. Report distribution and uncertainty; expand the pilot if too few eligible cycles occur.

## **Release criteria**

The competition demo must complete the full journey and every scripted exception without duplicate assignments or an automatic ready state. A live pilot starts only after camera mapping, masking, permissions, offline behavior, concurrency, and staff training pass. Expansion depends on acceptable detection quality, measured delay reduction, staff adoption, and a viable measured cost per outlet.

# **Business proposition and delivery plan**

## **Customer value and differentiation**

The buyer is a casual-dining outlet manager or operator; the daily users are the host and floor team. The value proposition is quicker table handoffs and better visibility during busy service, using a compatible existing camera system plus a local gateway.

The proposed distinction is the complete connection between visual observations, clearing work, waiting-party demand, and actual seating. The product makes each recommendation actionable and records whether the action was completed. This is a positioning hypothesis to validate through operator interviews and a separate competitor review; it is not a claim of uniqueness.

## **Commercial model**

Propose a business-to-business subscription per outlet, with one-time camera mapping and gateway setup. A base plan can cover the agreed table and camera limits; higher-volume outlets would pay for additional coverage and analytics. Validate willingness to pay after demonstrating the workflow. No selling price is committed in this PRD.

Measure inference calls, image volume, API usage, storage, support time, and gateway cost before setting pricing. For a sizing example, two cameras sampled every 10 seconds over 10 service hours produce 7,200 camera samples per day. Table crops may create more model calls unless batched. This is a workload estimate, not a cost forecast.

Business value should use extra parties actually seated and their measured contribution margin, less operating cost. Recovered table minutes alone do not prove extra sales; demand, kitchen capacity, and staffing may remain the constraint.

## **Proposed build sequence**

| Stage | Deliverable | Exit condition |
| :---- | :---- | :---- |
| 1 Foundation | Mapped tables, manual board, roles, queue, tasks, audit events. | Manual end-to-end workflow works on one outlet. |
| 2 Visual input | Gateway, model schema, observations, departure review, freshness. | Held-out footage and stale-input cases pass. |
| 3 Seating | Clearing priorities, seat eligibility, transactional holds. | Constraint and simultaneous-acceptance cases pass. |
| 4 Evidence | Shift metrics, BigQuery export, labelled replay, error recovery. | Metrics trace to events; demo and pilot checklist pass. |

Timing depends on camera access and team capacity. Assign ownership for the gateway and model, API and state rules, staff interface, and evaluation before committing dates.

## **Competition demo**

Show one occupied table becoming vacant, a staff-confirmed departure, a prioritized clearing task, a ready confirmation, and a capacity-matched seating hold. Then show temporary absence, a camera outage, and two hosts accepting the same table. End with the cycle timeline and shift metrics. Use labelled replay if live footage is unreliable and clearly identify the replay and simulated queue.

# **Risks and decisions before launch**

| Risk | Required response |
| :---- | :---- |
| Poor camera view | Test each mapped region. Use manual state or change the camera position when coverage fails. |
| Temporary absence | Keep session ownership; require staff departure confirmation before clearing. |
| Incorrect visual inference | Validate on held-out recordings, expose uncertainty, and keep readiness human-confirmed. |
| Cost or model latency | Benchmark sampled and batched calls; enforce budgets; reduce calls when safe. |
| Staff ignore prompts | Measure nuisance alerts and task adoption; adjust workflow during shadow shifts. |
| No seating bottleneck | Measure baseline delay and waiting demand; avoid claiming value where kitchen capacity limits service. |

## **Decisions to settle with the pilot outlet**

* Choose the outlet, camera protocol and coverage, permission to process footage, and gateway hardware.  
* Agree who confirms departures and readiness, who owns queue skips, and how manual service works during outages.  
* Set supported model and deployment region after latency, quota, availability, and data-processing checks. Confirm the actual daily inference budget.  
* Confirm pilot shifts, baseline observers, table and camera limits, retention settings, and commercial interview questions.

## **Launch checklist**

Before real service, verify end-to-end timestamps; camera masking; outlet authorization; manual correction; atomic task claims and seating holds; delayed and duplicate event handling; recovery from camera and model failure; correct queue restoration; evidence deletion; and staff training. Keep the manual host workflow available throughout the pilot.

## **Technical references**

The architecture is our proposed design. These official references support the underlying service capabilities; they do not establish the restaurant model's accuracy or the business targets. Reviewed 10 October 2026\.

[1 Google Cloud image understanding](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding)

[2 Google Cloud structured output](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output)

[3 Google Cloud Pub/Sub with Cloud Run](https://docs.cloud.google.com/run/docs/tutorials/pubsub)

[4 Google Cloud Run request timeouts](https://docs.cloud.google.com/run/docs/configuring/request-timeout)

[5 Firebase Firestore realtime updates](https://firebase.google.com/docs/firestore/query-data/listen)

[6 Firebase Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

[7 Google Cloud BigQuery overview](https://docs.cloud.google.com/bigquery/docs/introduction)