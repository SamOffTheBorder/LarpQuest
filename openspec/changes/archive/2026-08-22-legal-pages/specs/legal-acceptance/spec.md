## ADDED Requirements

### Requirement: Legal documents served in-app
The system SHALL serve the Terms of Service, Privacy Policy, and Acceptable Use Policy at stable in-app URLs, rendered from their source Markdown files, and SHALL link to all three from a footer visible on every page.

#### Scenario: Visitor reads the Terms
- **WHEN** a visitor navigates to `/terms`
- **THEN** the current content of the Terms of Service is rendered as a readable page

#### Scenario: Visitor reads the Privacy Policy
- **WHEN** a visitor navigates to `/privacy`
- **THEN** the current content of the Privacy Policy is rendered as a readable page

#### Scenario: Visitor reads the Acceptable Use Policy
- **WHEN** a visitor navigates to `/acceptable-use`
- **THEN** the current content of the Acceptable Use Policy is rendered as a readable page

#### Scenario: Footer links are present everywhere
- **WHEN** any page in the app is rendered
- **THEN** the footer includes links to the Terms, Privacy Policy, and Acceptable Use Policy pages

### Requirement: Acceptance recorded before a sign-in link is sent
The system SHALL require confirmation of agreement to the current Terms, Privacy Policy, and Acceptable Use Policy before sending a sign-in link, and SHALL record the confirming email address, a version identifier for each document, and a timestamp.

#### Scenario: Sign-in without confirming agreement
- **WHEN** a visitor submits the sign-in form without checking the agreement checkbox
- **THEN** the system SHALL reject the request and not send a sign-in link

#### Scenario: Sign-in with confirmed agreement
- **WHEN** a visitor submits the sign-in form with the agreement checkbox checked
- **THEN** the system records the email, each document's current version, and the current time, then proceeds to send the sign-in link

#### Scenario: Document version reflects current content
- **WHEN** the content of a legal document changes
- **THEN** the version identifier recorded on the next acceptance SHALL differ from the version recorded before the change
