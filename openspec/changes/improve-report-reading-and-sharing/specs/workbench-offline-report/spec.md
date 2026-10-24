## ADDED Requirements

### Requirement: Accessible image redaction in original pixels
The Viewer SHALL allow users to select, draw, adjust, remove and undo opaque redaction rectangles on registered PNG previews, with keyboard and numeric alternatives. Stored masks SHALL use original-image coordinates, outward rounding and explicit bounds, independent of zoom, device pixel ratio or orientation. No image SHALL have more than 64 masks. Only actual transformed pixels from the existing image pipeline SHALL count as redacted output.

#### Scenario: Draw while zoomed
- **WHEN** a user draws a mask on a scaled or rotated-orientation screenshot preview
- **THEN** the resulting original-pixel rectangle covers the selected source region, the transformed preview removes those pixels and the original artifact remains unchanged

#### Scenario: Keyboard redaction and invalid geometry
- **WHEN** a keyboard user creates or adjusts a mask, or supplies zero-area, non-finite or invalid bounds
- **THEN** valid geometry can be reviewed without a pointer and invalid geometry is rejected with an actionable local error

### Requirement: Reviewed report snapshot is the only rendering input
The HTML renderer SHALL accept only a versioned sanitized report snapshot containing approved derived assets and allowlisted presentation fields. It MUST NOT access source run objects, device state, arbitrary files or raw logs. Any additional readable labels, expected/observed facts and validation dimensions SHALL pass through bounded sanitization and the same final review as the assets. Unrepresentable or omitted content SHALL be disclosed.

#### Scenario: Raw error contains a secret or markup
- **WHEN** a source error, locator or annotation contains private text or active markup without an approved safe projection
- **THEN** it is omitted with a scope explanation or safely transformed before review; the renderer cannot recover the raw value

#### Scenario: Runtime requirement is unsupported
- **WHEN** a report includes a required runtime check that was unsupported or not performed
- **THEN** the reviewed snapshot preserves that limitation and cannot represent it as a pass or omit it while claiming complete verification

### Requirement: Frozen preview and format-bound confirmation
The system SHALL preview all final HTML content and bind explicit confirmation to source manifest, selected materials, masks, presentation fields, template version, output format and final candidate-byte digest. Dynamic identifiers and generation time SHALL be frozen before review. Review authorization SHALL expire within ten minutes and after restart. Any bound input change SHALL require a new preview. Downloaded bytes MUST match the confirmed candidate.

#### Scenario: Mask or format changed after review
- **WHEN** a user changes a mask, summary field, template or output format after confirming the preview
- **THEN** export is disabled until a fresh matching preview is explicitly confirmed

#### Scenario: Candidate changed before download
- **WHEN** source identity or candidate bytes change between preview and publication
- **THEN** publication is rejected, no new download is exposed and the prior valid export remains available

### Requirement: Self-contained passive HTML reading
The system SHALL produce one HTML file readable offline through a file URL, without FlowAssert, a server or login. It SHALL label derived identity, source verdict, steps, verification limits and withheld content. Native navigation, disclosures and print styles SHALL work without scripts, external links/resources, forms or embedded foreign documents. Untrusted text MUST be escaped; images MUST be validated derived PNGs.

#### Scenario: Recipient opens the file offline
- **WHEN** a recipient opens an exported HTML report while offline
- **THEN** the reviewed summary, failure location and selected evidence remain readable, produce no external requests and do not offer device or replay actions

#### Scenario: Injection payload in an imported report
- **WHEN** an imported source contains script tags, event handlers, SVG, external URLs or path-like text
- **THEN** the HTML treats approved text as inert content, contains no executable injected nodes and performs no outbound resource loads

### Requirement: Derived semantics and archive compatibility
HTML reports SHALL remain presentation artifacts distinct from machine-importable JSON archives. Source verdict, derived current status, material-integrity checks and export generation time SHALL be separately labelled. Opening or hashing HTML MUST NOT imply a new test execution, independent acceptance or cryptographic proof of source authenticity. Existing archive version and required-feature compatibility rules, including runtime-aware exports, SHALL remain intact.

#### Scenario: Passed source exported as a derived report
- **WHEN** a passed source run is exported after redaction
- **THEN** the report shows the original reported pass separately from its not-revalidated derived status and is not eligible as an automatic passing baseline

#### Scenario: Older reader encounters a newer required feature
- **WHEN** a machine archive carries a required feature unknown to an older reader
- **THEN** existing conservative compatibility behavior is retained rather than silently flattening the result to a legacy pass or importing HTML as JSON

### Requirement: Bounded durable HTML export
HTML jobs SHALL reuse share ownership, cancellation, references, leases, capacity, queue and time budgets. Limits SHALL be 64 assets, 4 MiB each/16 MiB total, 4096×4096 pixels, 256 KiB text/8 KiB per field, 500 steps and 24 MiB HTML. Overflow MUST fail explicitly without silent omission. Publication SHALL be atomic; incomplete candidates MUST NOT be downloadable.

#### Scenario: Export interrupted or cancelled
- **WHEN** generation fails, is cancelled or is interrupted before commit
- **THEN** no incomplete output is exposed, original materials and previous exports survive and the task records a truthful terminal state without automatic restart replay

#### Scenario: Cancellation reaches commit boundary
- **WHEN** a cancellation arrives after indivisible commit has started
- **THEN** the UI reports the actual commit outcome and never both publishes the output and reports a rolled-back cancellation

### Requirement: Nonblocking export interaction
Material selection, transformation preview and download SHALL expose local progress and recoverable errors while independent history navigation remains usable. Duplicate requests with the same identity and content SHALL reuse an existing job. Changed content SHALL not reuse stale review or request identity. Failure SHALL retain the last usable preview clearly bound to its original inputs; current confirmation SHALL remain disabled when it is stale.

#### Scenario: Slow preview fails while navigating history
- **WHEN** preview lasts at least 500 ms, the user opens history and conversion then fails
- **THEN** history remains interactive, the prior valid preview is preserved with its original identity and no stale result is applied to another run
