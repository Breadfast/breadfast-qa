# Automation Framework for Web, Android, and iOS App Testing with Webhooks Support

This automation framework provides support for testing web, Android, and iOS applications, including the ability to test webhooks. It is built using Java and requires the IntelliJ IDE, Java 25 or higher, Ngrok CLI, Appium 3.0, and the appropriate Appium drivers.

## Prerequisites (Preparing your machine)

Before running the project, ensure that you have the following:

- IntelliJ IDE
- Java core is installed on your machine https://www.java.com/en/download/
- For Windows users: Install choco from here: https://chocolatey.org/install
- If you don't have git installed, install it using choco: https://community.chocolatey.org/packages/git
- Create a GitHub account and send your username to Automation lead then clone the project from GitHub
  - In order to be able to clone either from terminal/cmd/intelliJ you will need to do the below:
    - Open github website and login with your username and password
    - Go to this page https://github.com/settings/tokens/new
    - Name your access token with a unique name
    - Mark the below roles:
      - repo
      - Workflow
      - write:packages
      - gist
      - user
      - project
    - create a personal access token
    - Copy the token then use it while cloning through IntelliJ or terminal/CMD
      - While cloning from terminal CMD, you will be instructed to input the username and the password
      - In the password field, don't use the regular password but use the token that we just created
- Java 21 or higher installed on your machine. In intelliJ you can do the following after you open the project:
  - Go to File -> Project structure
  - In project menu:
    - SDK: Select Java 25 or higher and preferred to be oracle openJDK
    - Language Level: SDK default
  - In modules:
    - Language level: Select project/language default.
- Ngrok CLI download using `choco` or `brew` and you can find the command here: [https://ngrok.com/download](https://ngrok.com/download)
- Slack API Token Created through here: https://api.slack.com/apps
  - Once you open the link, create an app and call it anything (ex: OTP Reader)
  - In your app settings, go to OAuth and Permissions
    - Add these scopes to Bot Token and User Token
      - channels:history
      - channels:read
      - search:read
    - From OAuth Tokens for your Workspace
      - Install to workspace
      - Copy User OAuth Token and add it to config.properties in key `slackApiToken`
- Ngrok account with an Auth key (sign up on the Ngrok website to obtain the Auth key)
- Install `ffmpeg` tool for mobile app video recordings
  - On macOS, run this command in terminal `brew install ffmpeg`
  - On windows, run this command in (CMD or powershell) with Administrator privilege `choco install ffmpeg`
  - On linux, run this command in terminal `sudo apt install ffmpeg`
- For Windows users: Install Node.js LTS version: https://nodejs.org/en
- Appium 2.0 installed using npm command. Refer to the official Appium documentation below:
  - https://appium.io/docs/en/2.0/quickstart/install/
- After you install appium run the below commands:
  - Appium Driver `uiAutomator2` installed. Use the command `appium driver install uiautomator2` to install it.
  - Appium Driver `XCUITest` installed. Use the command `appium driver install xcuitest` to install it.
- chromeDriver to be downloaded and added to the resources directory in the webDrivers folder. (resources/webDrivers)
  - You can download it from here: https://googlechromelabs.github.io/chrome-for-testing/#stable
- Add your builds (APK/APP files) to your `builds` directory in resources (resources/builds)
  - You can reach out to testing-team channel asking for the latest builds for automation
- Android Studio Setup:
  - Download and install android studio latest version: https://developer.android.com/studio
  - After you install android studio add the environment variables:
    - ##### MacOS: (Run the below commands)
      - Install zsh and ohMyZsh by following the guide here: https://github.com/ohmyzsh/ohmyzsh/wiki/Installing-ZSH
      - Open zsh terminal and execute the below commands:
        - `nano ~/.zshrc`
        - add the below lines to it and update the existing to include the values below if the key already exists:
          - `export JAVA_HOME=/Users/**<YOUR USERNAME>**/Library/Java/JavaVirtualMachines/openjdk-21/Contents/Home` 
          - `export ANDROID_HOME=$HOME/Library/Android/sdk` 
          - `export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"`
          - `export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk` 
          `- export ANDROID_AVD_HOME=$HOME/.android/avd`
        - save and exit the nano editor using `CTRL + O`
        - Execute command: `source ~/.zshrc`
    - ##### Windows:
      - Add the below environment variables to your system variables in windows:
        - `ANDROID_AVD_HOME` `C:\Users\Breadfast\.android\avd`
        - `ANDROID_HOME` `C:\Users\Breadfast\AppData\Local\Android\Sdk`
        - `ANDROID_SDK_ROOT` `C:\Users\Breadfast\AppData\Local\Android\Sdk`
        - `ANDROID_USER_HOME` `C:\Users\Breadfast\.android`
        - `JAVA HOME` `C:\Program Files\Java\jdk-21`
      - In your system variables, click on PATH then click the edit button and add the below variables in same order:
        - `C:\Users\Breadfast\AppData\Local\Android\Sdk`
        - `C:\Users\Breadfast\AppData\Local\Android\Sdk\emulator`
        - `C:\Users\Breadfast\AppData\Local\Android\Sdk\tools`
        - `C:\Users\Breadfast\AppData\Local\Android\Sdk\platform-tools`
      - Enable virtualization/HAX-M using this guide [here](https://support.microsoft.com/en-us/windows/enable-virtualization-on-windows-11-pcs-c5578302-6e43-4b4b-a449-8ced115f58e1)
  - After you finalize the above. Create an android emulator on a device with below specs:
    - Name: `Pixel_2` -> Name has to be exactly the same
    - API level: 31 (Android 12)
    - Boot type: Cold Boot
    - Leave everything else on the default values and submit
    - **Note: DON'T RUN THE EMULATOR FROM ANDROID STUDIO**
    - To run the emulator, you can run the below command and make sure the emulator is running:
      - `emulator -avd Pixel_2 -read-only -no-boot-anim -no-snapshot-save -netdelay none -netspeed full -no-audio`
  - Appium Inspector Installation and configuration:
    - To be able to inspect UI elements on the emulator/simulator, you will need an appium inspector.
      - Download latest version from: https://github.com/appium/appium-inspector/releases
      - Install on your machine
      - You will need to add and save a capability set for the emulator/simulator you will be testing on:
        - Android (Create a capability set named AVD Pixel 2) and add the below JSON to it from the right side
          - Modify the path in appium:app to the path of the APK in the repo resources/builds
            - `{
              "platformName": "Android",
              "appium:platformVersion": "12",
              "appium:deviceName": "Pixel_2",
              "appium:automationName": "UiAutomator2",
              "appium:app": "<Path to apk in the repo>",
              "appium:settings[snapshotMaxDepth]": 62
              }`
              - For Windows users : add another slash to each slash in path after copying it , if the path is `C:\Users\Breadfast H\IdeaProjects\QA_Automation_Framework\resources\builds\app.apk` , 
              edit it to be `C:\\Users\\Breadfast H\\IdeaProjects\\QA_Automation_Framework\\resources\\builds\\app.apk`
        - iOS (Create a capability set named iPhone 14) and add the below JSON to it from the right side
          - Modify the path in appium:app to the path of the .zip file in the repo resources/builds
            - `{
              "platformName": "iOS",
              "appium:platformVersion": "17.2",
              "appium:deviceName": "iPhone 14",
              "appium:automationName": "XCUITest",
              "appium:app": "<Path to apk in the repo>",
              "appium:bundleId": "com.breadfast.breadfast",
              "appium:settings[snapshotMaxDepth]": 62
              }`
      - To run the appium server manually, in your `cmd`/`terminal`. Run the command `appium`
      - If you want to start an inspector session on iOS
        - you just press the start session button while selecting the iPhone 14 capability set
      - If you want to start an inspector session on android
        - Start the emulator from another `cmd` using the command mentioned above.
        - Press start session button while selecting the "AVD Pixel 2" capability set

## Configuration (Preparing your project's configs)

  - There are 5 config files and 2 files for cardServicePublicKey and database-SSH Key handling the project execution environments. Please, follow the below guide to build them:
    - In the project's terminal on intelliJ, run the below commands:
      - `cp resources/environments/config.properties.example resources/environments/config_testing.properties` 
      - `cp resources/environments/webConfig.properties.example resources/environments/webConfig.properties` 
      - `cp resources/environments/cardServiceConfigs.properties.example resources/environments/cardServiceConfigs_testing.properties`
      - `cp resources/environments/cardServiceEncryptionPublicKey.pub.example resources/environments/cardServiceEncryptionPublicKey.pub`
      - `cp resources/environments/browserStackConfigs.properties.example resources/environments/browserStackConfigs.properties`
      - `cp resources/environments/iPhone_14.properties.example resources/environments/iPhone_14.properties` 
      - `cp resources/environments/Pixel_2.properties.example resources/environments/Pixel_2.properties`
      - `cp resources/environments/dbSshKey.example resources/environments/dbSshKey`
    - Android config file should remain as is
    - If you will be running iOS tests on macOS you will need to change the below:
      - iOS simulator UUID: You can run the below command: `xcrun simctl list device` and get the UUID for iPhone 14
      - iOS version to be the current latest installed on your macbook.
        - You can run the simulator manually, and it will be written at the top beside the simulator name
    - In your `config_<environmentName>.properties` file:
      - Add your slack token which we generated at the prerequisites steps as the value of key slackApiToken
      - Add your ngrok token which we generated at the prerequisites steps
      - Add the admin phone number without 0, if you don't have one, message the channel `testing-team`
      - Add your email address
      - Add your login byPassScriptPassword that should be applied while logging in to web dashboards
        - If you don't have 1, message testing-team channel as it should match your admin phone number
      - Now add the base URLs and you can find your needed URLs [here](https://breadfast.atlassian.net/wiki/spaces/BREAD/pages/1385267202/Base+URLs+based+on+environments)
  - There are 2 git hooks files that are acting as pre-checks for .git operations to validate on the branch names:
    - In the project's terminal on IntelliJ, run the below commands:
      - `cp resources/environments/pre-commit.example .git/hooks/pre-commit`
      - `cp resources/environments/pre-push.example .git/hooks/pre-push`

## Running the Project

  - Open the project in the IntelliJ IDE.
  - Build the project and make sure the build process is completed and all dependencies are loaded
  - Wait until the maven dependencies are loaded 
  - Running a web test:
    - Navigate to the file: src/test/java/mainAdminPortal/authentication/LoginTests.java
    - Run the test: loginWithValidLocalPhoneNumber from the green arrow on the left side of the testName
    - Validate that it passes successfully
  - Running an android test:
    - Navigate to the file: src/test/java/customerApp/android/authentication/LoginTests.java
    - Run the test: loginWithValidLocalPhoneNumber from the green arrow on the left side of the testName
    - Validate that it passes successfully
  - Running an iOS test:
    - Navigate to the file: src/test/java/customerApp/ios/authentication/LoginTests.java
    - Run the test: loginWithValidLocalPhoneNumber from the green arrow on the left side of the testName
    - Validate that it passes successfully

## Support

If you encounter any issues or have questions related to the framework or its usage, please reach out to `testing-team`

## Contributing

Contributions to the framework are welcome. To contribute, please follow these guidelines:

1. You can not push your code directly to main. It has to be through pull requests
2. Pull the main branch and ensure you have the latest version of code
3. checkout and create a new branch in the following criteria:
   - YYYY/<sprintNumber>/feature-name-in-lower-case
     - Ex: 2024/sprintQ1.3/tests-for-now-and-tomorrow-ios
4. Commit and push your code to your branch and ensure it exists on GitHub
5. Once you are done with your edits, do the below:
   - Create a pull request
   - Add a short description about what your newly added tests are supposed to fulfill
   - Add video of the execution of each test to your PR description
   - Ensure 0 flakiness to your created tests
   - Ensure that same tests will run as is regardless of the target environment (QA, Staging, prod) with no changes to code
     - As we don't change code while switching environment, you need to modify your tests to comply to that condition
   - Ask your team lead to review the PR, and they will either approve or request-changes to the code

Please note that direct pushes to the main branch are not allowed. All changes must go through a pull request for review.

Thank you for your contributions to the project!
