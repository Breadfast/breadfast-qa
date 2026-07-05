# GitHub Actions Workflow Trigger Instructions

## Objective
Debug and run the E2E004ReturningUserWithReorderFlow test on BrowserStack using the mobile test GitHub Action workflow.

## Issue Fixed
**File**: [src/main/java/modals/customerApp/iosNative/iosNativeMorePage/IosNativeActivityHistoryScreen.java](src/main/java/modals/customerApp/iosNative/iosNativeMorePage/IosNativeActivityHistoryScreen.java#L72)

**Change**: Updated the `pressReorderBtn()` method to use `By.name()` instead of `By.id()` for proper iOS Appium selector compatibility.

```java
// Before (Line 72)
wait.until(ExpectedConditions.visibilityOfElementLocated(By.id(String.format(reorderBtnNameSelector, orderId)))).click();

// After (Line 72) - FIXED
wait.until(ExpectedConditions.visibilityOfElementLocated(By.name(String.format(reorderBtnNameSelector, orderId)))).click();
```

**Status**: ✅ FIXED (Commit: 45abd852d)

---

## How to Trigger the Workflow

### Option 1: Using GitHub Web UI (Recommended)

1. Go to: https://github.com/Breadfast/QA_Automation_Framework/actions/workflows/mobile-test.yml
2. Click **"Run workflow"** button (right side)
3. Configure the following inputs:
   - **Select the target environment**: `production`
   - **Select the target app platform**: `ios`
   - **Select the target app to test**: `customerAppNative`
   - **Select the target test name**: `CustomerAppNative_iOS`
   - **Type a group name for the tests**: `testFix`
   - **Enter the target-App ID from BrowserStack**: `bs://49efbc045f9bc583981081d68b0b0f6b4f9ee7b8`
   - **Enter the target-App build version and number**: `214`
4. Click **"Run workflow"**

### Option 2: Using GitHub CLI (If Installed)

```bash
gh workflow run mobile-test.yml \
  -f environment=production \
  -f target_app_platform=ios \
  -f target_app_name=customerAppNative \
  -f target_test_name=CustomerAppNative_iOS \
  -f target_app_id=bs://49efbc045f9bc583981081d68b0b0f6b4f9ee7b8 \
  -f target_app_build_number=214 \
  -f target_test_group=testFix
```

### Option 3: Using curl with GitHub API

First, ensure you have `GITHUB_TOKEN` set with proper permissions.

```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  https://api.github.com/repos/Breadfast/QA_Automation_Framework/actions/workflows/mobile-test.yml/dispatches \
  -d '{
    "ref": "main",
    "inputs": {
      "environment": "production",
      "target_app_platform": "ios",
      "target_app_name": "customerAppNative",
      "target_test_name": "CustomerAppNative_iOS",
      "target_app_id": "bs://49efbc045f9bc583981081d68b0b0f6b4f9ee7b8",
      "target_app_build_number": "214",
      "target_test_group": "testFix"
    }
  }'
```

---

## What the Workflow Does

The `mobile-test.yml` workflow will:

1. Validate all input parameters
2. Set up the test environment (Java, Maven, drivers)
3. Configure BrowserStack settings for production environment
4. Override the BrowserStack App ID with: `bs://49efbc045f9bc583981081d68b0b0f6b4f9ee7b8` (build 214)
5. Execute tests with: `mvn test` using the `mobile-tests` profile with:
   - Target test: `CustomerAppNative_iOS`
   - Test group: `testFix`
   - Thread count: 2 (for production environment)
6. Generate and upload test reports to BrowserStack Test Observability
7. Notify the team via Slack

---

## Monitoring the Workflow

After triggering:

1. View progress at: https://github.com/Breadfast/QA_Automation_Framework/actions/workflows/mobile-test.yml
2. Click on the latest run with your timestamp
3. Watch the logs in real-time
4. Once complete, review:
   - Test results in the workflow summary
   - Screenshots in the artifacts section
   - BrowserStack reports for detailed session information

---

## Expected Test Coverage

The workflow will run test methods tagged with:
- Group: `testFix`
- Tags: `@Tag("customer-app-native")`, `@Tag("ios")`, `@Tag("mobile-shopping")`

This includes the **E2E004ReturningUserWithReorderFlow** test which:
1. Creates a test user via API
2. Creates an address and order
3. Completes the order cycle
4. Logs in via the app
5. **Navigates to Activity History**
6. **Presses the Reorder button** ← (Uses the fixed selector here!)
7. Adds to cart and checks out
8. Verifies successful order placement

---

## Troubleshooting

### If the test still fails:

1. **Check BrowserStack Session**: Log into BrowserStack dashboard to view the actual test execution
2. **Review Appium Logs**: Check the test execution logs for selector errors
3. **Verify Element ID**: Confirm that the iOS element with name `order_[orderId]_reorderBtn` exists in the app at build 214
4. **Check XPath if needed**: If `By.name()` doesn't work, try an XPath selector instead

### Common Issues:

- **Timeout waiting for element**: The element might not be visible due to animation delays
- **Element not found**: The element name might have changed in the app build
- **NoSuchElementException**: Verify the element locator against the actual app UI

---

## Next Steps After Workflow Completion

1. Review test results in the GitHub Actions workflow summary
2. Check BrowserStack Automate for video recordings and screenshots
3. If tests pass: The fix is validated! ✅
4. If tests fail: Analyze the logs and adjust the selector if needed

