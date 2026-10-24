## ADDED Requirements

### Requirement: Uniform built-in Worker exit ownership
Native, analyzer, visual and share-image Workers SHALL retain operation ownership until actual exit on success, error, cancellation and timeout. Rejected termination MUST NOT allow early resource release. Native execution SHALL also drain accepted device calls. Late results SHALL NOT restore success after cancellation.

#### Scenario: Rejected termination before delayed exit
- **WHEN** terminate rejects but a Worker has not exited
- **THEN** the operation stays pending, its owner remains held, and after exit the termination failure is surfaced or represented as an inconclusive result

#### Scenario: Completion and cleanup
- **WHEN** a Worker exits after one result has won
- **THEN** timers and listeners are removed and repeated/late messages cannot publish another result
