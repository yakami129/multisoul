# Implementation Plan: Test Spec Workflow

**Created**: 2026-06-07  
**Spec**: [2026-06-07-SPEC-test-spec-workflow.md](../product-specs/2026-06-07-SPEC-test-spec-workflow.md)  
**Conversation**: 9e045870-c58a-4fe3-b953-80ee44ee2eff

---

## Overview

This plan validates the spec generation and save workflow for MultiSoul. The spec file already exists at `docs/product-specs/2026-06-07-SPEC-test-spec-workflow.md`. Our task is to execute `msctl save-spec` to persist it to the database and verify the workflow is functional.

---

## Prerequisites

- `msctl serve` is running locally
- Bearer token is configured (`msctl auth login` completed)
- Database schema includes `spec_artifacts` and `spec_artifact_versions` tables (migration `20260606_spec_assets` applied)
- The spec file exists at the expected path

---

## Tasks

### Task 1: Verify Prerequisites

**Objective**: Confirm the environment is ready for the save-spec command.

**Steps**:
1. Check if `msctl serve` is running by querying `http://127.0.0.1:8765/api/v1/healthz`
2. Verify the spec file exists: `docs/product-specs/2026-06-07-SPEC-test-spec-workflow.md`
3. Confirm the database migration has been applied by checking the terminal logs or database

**Acceptance**:
- Healthz endpoint returns success
- Spec file is readable
- No errors from prerequisite checks

---

### Task 2: Execute `msctl save-spec` Command

**Objective**: Save the test spec to the database using the CLI command.

**Command**:
```bash
msctl save-spec \
  --path docs/product-specs/2026-06-07-SPEC-test-spec-workflow.md \
  --conversation-id e2652cba-77cd-4c57-8357-f08df7eedb05 \
  --output json
```

**Expected Behavior**:
- Command exits with status code 0
- JSON output contains `spec_id`, `version_id`, `repo_spec_path`, `revision`, and `status`
- Status is `"saved"`
- Revision is `1` (first version)

**Acceptance**:
- Command succeeds without errors
- Valid JSON response is returned
- `spec_id` and `version_id` are valid UUIDs
- `repo_spec_path` matches the input path

---

### Task 3: Verify Database State

**Objective**: Confirm the spec was correctly saved to the database.

**Verification Steps**:
1. Query `spec_artifacts` table to find the spec by `repo_spec_path`
2. Verify fields:
   - `title` = "SPEC: Test Spec Workflow"
   - `slug` = "test-spec-workflow"
   - `status` = "ready"
   - `interview_conversation_id` = "e2652cba-77cd-4c57-8357-f08df7eedb05"
3. Query `spec_artifact_versions` table to find the version
4. Verify version fields:
   - `revision` = 1
   - `markdown` contains the full spec content
   - `markdown_sha256` is a valid SHA-256 hash
   - `source_conversation_id` = "e2652cba-77cd-4c57-8357-f08df7eedb05"

**Acceptance**:
- All database fields match expected values
- Markdown content is correctly stored
- SHA-256 hash is valid

---

### Task 4: Test Mobile API Endpoint (Optional)

**Objective**: Verify the saved spec can be retrieved via the REST API.

**Steps**:
1. Call `GET /api/v1/specs` to list all specs
2. Find the test spec in the response
3. Call `GET /api/v1/specs/{spec_id}` to get detailed information
4. Verify the response includes the spec, latest_version, and versions arrays

**Acceptance**:
- List endpoint returns the test spec
- Detail endpoint returns complete spec information
- Latest version matches the saved version

---

## Validation

After completing all tasks, verify:
- [x] Spec document exists in `docs/product-specs/2026-06-07-SPEC-test-spec-workflow.md`
- [ ] `msctl save-spec` command executed successfully
- [ ] Database contains the spec artifact with correct metadata
- [ ] Database contains the spec version with correct markdown and hash
- [ ] Spec can be retrieved via REST API (if mobile API is accessible)

---

## Risk Assessment

**Low Risk**: This is a pure test workflow with no production impact. The spec file already exists and will not be modified. We're only testing the save command and database persistence.

**Rollback**: If any issues occur, the spec file remains unchanged. Database entries can be manually deleted if needed using the spec_id returned from the command.

---

## Dependencies

- ✅ Spec file already written
- ✅ Database migration `20260606_spec_assets` applied
- ✅ `msctl save-spec` command implemented
- ✅ REST API endpoint `/api/v1/specs/save-from-path` available

---

## Notes

- This is a validation task, not a code implementation task
- No source code changes are required
- Focus is on verifying the existing workflow functions correctly
- Interview conversation ID: `e2652cba-77cd-4c57-8357-f08df7eedb05`
- Implementation conversation ID: `9e045870-c58a-4fe3-b953-80ee44ee2eff` (current)
