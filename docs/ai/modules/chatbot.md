# Module — Chatbot

> Living document. **Scope not yet confirmed** — no chatbot story has been tested on this project as of this writing. Populate from the first real chatbot ticket; do not invent behavior.

## Purpose
Customer-facing chatbot `(unconfirmed)`. To be defined when a chatbot PRD/story is assigned.

## To capture on first chatbot story
- Where it lives (Customer App tab / web / WhatsApp / Control Room) and entry points.
- Supported intents / conversation flows / fallback behavior.
- Languages (EN/AR) and RTL handling.
- Backend / NLP service dependencies and APIs.
- Data dependencies (user context, order history, card status).
- Testing considerations (happy-path intents, misunderstood input, handoff to human, localization).
- Regression considerations.
- Automation entry points (web → Playwright; in-app → mobile WebDriver).

Until then, treat any chatbot request as a new-module discovery: run the clarification phase, document findings here, and route reusable knowledge per [../release-validation.md](../release-validation.md) §5.

## Java framework assets (`D:\projects`)

See [../automation/java-framework.md](../automation/java-framework.md) for the full catalog.

**Page objects (modals)**
- Web SDK — `src/main/java/modals/chatbotSdk/`: `ChatbotSdkHostPage`, `WebChatbotSdk`.
- In-app — `modals/customerApp/{android,ios,androidNative,iosNative}/*ChatBotScreen` and RN `*FreshChatScreen`.

**API clients** — `helpers/apiClients/mobileApiClients/ChatbotApiClient` (`generateChatbotJwt(user)`), `FreshChatApiClient` (FreshChat conversations/messages). Token source: `dataProviders/UsersChatbotTokensProviderSource`.

**Models** — `FreshChatConversation`, `FreshChatMessage` (parser: `dataParsers/FreshChatMessageDataParser`).

**Test suites** — `src/test/java/customerApp/android/chatbot/*` and `ios/chatbot/*` (`IHaveAnIssueTests`, `IHaveAProblemComplaintTests`, `IHaveAQuestionTests`, `NonOfTheAboveTests`), `ios/homePage/chatbot/HaveProblemTests`, `web/chatbot/ChatbotSdkWebTests` + `ChatbotApiTests`. Chatbot perf tests run under `stressng.xml`.
