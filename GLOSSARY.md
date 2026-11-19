# Cadence

Cadence sells video courses to students. This glossary covers the language around buying, taking, refunding, and being notified about courses.

## Language

### People

**Student**:
Someone who takes courses on Cadence.
_Avoid_: Learner, User

**Instructor**:
A person who builds and owns courses, and sees the Students enrolled on them.
_Avoid_: Teacher, Author, Creator

**Platform Admin**:
A member of Cadence staff who runs the platform. Only a Platform Admin decides Refund Requests.
_Avoid_: Admin (on its own), the team, Staff

**Team Admin**:
A Student who buys and manages a Team Licence. A Team Admin has no say over Refund Requests.
_Avoid_: Admin (on its own)

### Enrollment

**Enrollment**:
A Student's place on a course, which lets them take it. A Student has at most one Enrollment per course, whether it came from an Individual Purchase or a Claimed Seat.
_Avoid_: Place on a course, Access

**Lapsed**:
A Student who has lost their Enrollment on a course but still has progress on it.

**Watched**:
Seconds of video a Student has actually played in a course: the furthest point reached in each lesson, added up. Not lessons opened.
_Avoid_: Viewed, Progress

### Purchases

**Purchase**:
A single payment for a course. It is either an Individual Purchase or a Team Licence.
_Avoid_: Order, Transaction

**Individual Purchase**:
A Purchase a Student makes for themselves. It gives the buyer an Enrollment.

**Team Licence**:
A Purchase a Team Admin makes for others. It grants Seats, not an Enrollment; the buyer can't take the course through it.
_Avoid_: Team purchase, Bulk purchase

**Seat**:
One place on a Team Licence that a Student can claim to get an Enrollment.
_Avoid_: Coupon, Code, Voucher

**Unclaimed Seat**:
A Seat no Student has claimed yet.

**Claimed Seat**:
A Seat a Student has claimed. It belongs to that Student, so a Team Licence with any Claimed Seat can't be refunded.

### Refunds

**Refund Request**:
The buyer's ask, with their reason, to get back what they paid for one specific Purchase. A Platform Admin approves or declines it. One Purchase can have several Refund Requests over time, but only one can be undecided at once.
_Avoid_: Refund (for the ask itself), Cancellation, Reversal, Chargeback

**Open Refund Request**:
A Refund Request no Platform Admin has decided yet. The buyer keeps their Enrollment while it is open, and a Team Licence's Unclaimed Seats can't be claimed.
_Avoid_: Pending, Requested, Awaiting review

**Approved Refund Request**:
A Refund Request a Platform Admin has accepted. Approving it ends what the Purchase granted (the buyer's Enrollment for an Individual Purchase; its Unclaimed Seats, which can then never be claimed, for a Team Licence) and leads to a Refund.

**Declined Refund Request**:
A Refund Request a Platform Admin has turned down. Nothing the Purchase granted is lost, it has no Refund, and the buyer may raise a new Refund Request.

**Refund**:
The money returned to the buyer after their Refund Request is approved. It is always the full amount they paid. A declined Refund Request has no Refund.
_Avoid_: Reversal, Chargeback, Cancellation

**Pending Refund**:
A Refund whose Refund Request has been approved, where the money hasn't been confirmed as sent yet.
_Avoid_: Pending (for a Refund Request awaiting review)

**Issued Refund**:
A Refund where the money has been confirmed as sent back to the buyer.
_Avoid_: Completed, Paid out

**Failed Refund**:
A Refund where the money couldn't be sent. The Refund Request stays approved, because the decision hasn't changed.

**Watch Limit**:
The amount of Watched time on a course past which a Student can no longer get a Refund, because they've had the course.
_Avoid_: Watch cap, Viewing threshold

### Notifications

**Notification**:
Cadence telling one user that something happened. Each happening is its own Notification for each person it is addressed to, and a Notification never changes once it is created.
_Avoid_: Alert, Message, Ping

**Notification Event**:
A catalog entry delivered per the recipient's event×channel preferences — in-app always, email and push as preferred. A happening may emit several events, each with exactly one kind.
_Avoid_: Optional event, Preferenced event, Class

**Transactional Event**:
A catalog entry that is always delivered on every channel it can appear on — email and in-app, never push. It is exempt from notification preferences.
_Avoid_: System email, Mandatory event

**Notification Catalog**:
The registry of every happening Cadence tells people about, each entry naming its kind, who it is addressed to, and what it says on each channel. Adding a happening to tell people about is adding an entry.
_Avoid_: Event list, Registry

**Notification Preferences**:
A user's choices, one per Notification Event per channel — in-app, email, or push — for which events reach them where. All on by default, and a Transactional Event is exempt.
_Avoid_: Notification settings, the matrix, subscriptions

**Unread Notification**:
A Notification its recipient has not read yet. The bell's count is a user's Unread Notifications.
_Avoid_: New, Pending, Unseen

**Read Notification**:
A Notification its recipient has read, by opening it or marking it read. Only the recipient can read a Notification — what happens to the thing it is about never does — and a Read Notification stays read.
_Avoid_: Seen, Acknowledged, Handled

**Device**:
A phone or computer a user has turned on push notifications from, listed in Settings under "Your devices". A Device belongs to the user who turned it on and manages itself — only the browser that subscribed can turn it off.
_Avoid_: Phone, Browser, Push token
