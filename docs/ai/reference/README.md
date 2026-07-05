# Reference Docs (imported from the Java framework at D:\projects)

> Read-only reference material copied from the canonical Breadfast Java/Appium/Maven QA
> framework at **`D:\projects`** on 2026-06-21. These are setup guides, specs, and example
> artifacts — **not** the framework code and **not** secrets. The live framework (page objects,
> API clients, models, configs) stays at `D:\projects`; the companion references it there.
> Catalog of that framework: [../automation/java-framework.md](../automation/java-framework.md).

| File | What it is |
|------|-----------|
| `framework_readme.md` | The Java framework's own README |
| `APPIUM_MCP_SETUP_GUIDE.md` | How to set up the Appium MCP for mobile automation |
| `APPIUM_MCP_POC_DOCUMENTATION.md` | Appium MCP proof-of-concept notes |
| `TECHNICAL_SPECIFICATION.md` | Framework technical spec |
| `QUICK_START_GUIDE.md` | Quick start for the Java framework |
| `WORKFLOW_TRIGGER_INSTRUCTIONS.md` | How CI/automation workflows are triggered |
| `DOCUMENTATION_INDEX.md` | Index of the framework's own docs |
| `CustomerApp_Native_iOS_Test_Automation_Coverage_Report.md` | Example coverage report (Native iOS) |
| `TC_B10-55168_test_cases.csv` | Example BrowserStack test-case CSV (see CSV spec in [../browserstack-process.md](../browserstack-process.md) §10) |
| `appium-mcp-config.json` | Appium MCP config example |
| `suites/*.xml` | TestNG suite definitions (testng, mobile, sanity, regression, fintech, master) — reference classes in `D:\projects\src\test\java` |
| `suites/hyperexecute.yaml` | LambdaTest HyperExecute execution config |

**Not copied (by design):** the 663 Java source files, `resources/environments/*.properties` (contain DB/BrowserStack/SSH secrets — referenced in place), Confluence-publishing scripts, and run artifacts (screenshots/logs/allure/target).

The properties files the JS frameworks depend on remain at:
`D:\projects\resources\environments\config_testing.properties` and `cardServiceConfigs_testing.properties`.
