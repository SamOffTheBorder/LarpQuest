## ADDED Requirements

### Requirement: Turn submission completeness
A story's members SHALL be able to see how many of the turn's claimed entities have submitted, updating live as submissions are created.

#### Scenario: Partial submissions
- **WHEN** 2 of 5 claimed entities have submitted for the open turn
- **THEN** members subscribed to that turn's presence channel see "waiting on 3 of 5"

#### Scenario: Submission arrives
- **WHEN** another claimed entity's controller submits
- **THEN** subscribed members' view updates without a page reload

### Requirement: Story online presence
A story's members SHALL be able to see which other members currently have the story open.

#### Scenario: Member opens the story
- **WHEN** a member navigates to an open story
- **THEN** other subscribed members see that member as online

#### Scenario: Member closes the story
- **WHEN** a member navigates away or disconnects
- **THEN** other subscribed members see that member as offline within Realtime's presence timeout

### Requirement: Presence has no effect on turn-loop correctness
Realtime presence SHALL be advisory only. No turn-loop transition or generation outcome may depend on presence channel state.

#### Scenario: Presence channel unavailable
- **WHEN** the Realtime connection is down or unavailable to a client
- **THEN** submission, lock, and generation continue to function normally through the existing request path
