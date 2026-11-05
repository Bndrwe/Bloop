# Bloop macOS e2e (macOS 14.8.9, arm64, runner GitHub Actions 1000001900)

App: `/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app` (bundle id edu.bloop.app)

## A: launch without permissions
  launched A via open (LaunchServices), pid(s): 22104 
  `[bloop] permissions: screen=denied automation=unknown onboarding=true`
  last refresh: `[bloop] permissions(refresh): screen=denied automation=unknown onboarding=true`
- PASS: A: app started and logged its permission state
- PASS: A: Screen Recording is NOT reported granted before the grant
- PASS: A: session auto-started
- PASS: A: real active-window samples are being taken (not "Unknown")
  raw samples: `[bloop] trace raw: app="Bloop" titleLen=0 url=- nativeUrl=no`
  sample lines (last 3):
      [bloop] sample app="Bloop" category=neutral score=null
      [bloop] sample app="Bloop" category=neutral score=null
      [bloop] sample app="Bloop" category=neutral score=null

## A2: grant in TCC.db while Bloop is still running (no relaunch)
      designated requirement (Safari): identifier "com.apple.Safari" and anchor apple
      --- schema (/Library/Application Support/com.apple.TCC/TCC.db)
      CREATE TABLE access (    service        TEXT        NOT NULL,     client         TEXT        NOT NULL,     client_type    INTEGER     NOT NULL,     auth_value     INTEGER     NOT NULL,     auth_reason    INTEGER     NOT NULL,     auth_version   INTEGER     NOT NULL,     csreq          BLOB,     policy_id      INTEGER,     indirect_object_identifier_type    INTEGER,     indirect_object_identifier         TEXT NOT NULL DEFAULT 'UNUSED',     indirect_object_code_identity      BLOB,     flags          INTEGER,     last_modified  INTEGER     NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),     pid            INTEGER,     pid_version    INTEGER,     boot_uuid      TEXT NOT NULL DEFAULT 'UNUSED',     last_reminded  INTEGER     NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),     PRIMARY KEY (service, client, client_type, indirect_object_identifier),    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE ON UPDATE CASCADE);
      --- schema (/Users/runner/Library/Application Support/com.apple.TCC/TCC.db)
      CREATE TABLE access (    service        TEXT        NOT NULL,     client         TEXT        NOT NULL,     client_type    INTEGER     NOT NULL,     auth_value     INTEGER     NOT NULL,     auth_reason    INTEGER     NOT NULL,     auth_version   INTEGER     NOT NULL,     csreq          BLOB,     policy_id      INTEGER,     indirect_object_identifier_type    INTEGER,     indirect_object_identifier         TEXT NOT NULL DEFAULT 'UNUSED',     indirect_object_code_identity      BLOB,     flags          INTEGER,     last_modified  INTEGER     NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),     pid            INTEGER,     pid_version    INTEGER,     boot_uuid      TEXT NOT NULL DEFAULT 'UNUSED',     last_reminded  INTEGER     NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),     PRIMARY KEY (service, client, client_type, indirect_object_identifier),    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE ON UPDATE CASCADE);
      inserted kTCCServiceScreenCapture edu.bloop.app (0) -> UNUSED into Application Support/TCC.db [system]
      inserted kTCCServiceScreenCapture /Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop (1) -> UNUSED into Application Support/TCC.db [system]
      inserted kTCCServiceScreenCapture edu.bloop.app (0) -> UNUSED into Application Support/TCC.db [user]
      inserted kTCCServiceScreenCapture /Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop (1) -> UNUSED into Application Support/TCC.db [user]
      inserted kTCCServiceAppleEvents edu.bloop.app (0) -> com.apple.Safari into Application Support/TCC.db [user]
      inserted kTCCServiceAppleEvents /Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop (1) -> com.apple.Safari into Application Support/TCC.db [user]
      inserted kTCCServiceAppleEvents edu.bloop.app (0) -> com.apple.Safari into Application Support/TCC.db [system]
      inserted kTCCServiceAppleEvents /Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop (1) -> com.apple.Safari into Application Support/TCC.db [system]
      --- rows for Bloop in /Library/Application Support/com.apple.TCC/TCC.db
      service|client|client_type|auth_value|auth_reason|indirect_object_identifier|csreq_len|ind_req_len
      kTCCServiceScreenCapture|edu.bloop.app|0|2|4|UNUSED|40|
      kTCCServiceScreenCapture|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|UNUSED|40|
      kTCCServiceAppleEvents|edu.bloop.app|0|2|4|com.apple.Safari|40|44
      kTCCServiceAppleEvents|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|com.apple.Safari|40|44
      --- rows for Bloop in /Users/runner/Library/Application Support/com.apple.TCC/TCC.db
      service|client|client_type|auth_value|auth_reason|indirect_object_identifier|csreq_len|ind_req_len
      kTCCServiceScreenCapture|edu.bloop.app|0|2|4|UNUSED|40|
      kTCCServiceScreenCapture|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|UNUSED|40|
      kTCCServiceAppleEvents|edu.bloop.app|0|2|4|com.apple.Safari|40|44
      kTCCServiceAppleEvents|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|com.apple.Safari|40|44
  frontmost after activating Safari: Safari
  refresh after grant: `[bloop] permissions(refresh): screen=denied automation=granted onboarding=true`
      [bloop] trace raw: app="Safari" titleLen=0 url=https://en.wikipedia.org/wiki/Study_skills nativeUrl=no
      [bloop] trace raw: app="Safari" titleLen=0 url=https://en.wikipedia.org/wiki/Study_skills nativeUrl=no
      [bloop] trace raw: app="Safari" titleLen=0 url=https://en.wikipedia.org/wiki/Study_skills nativeUrl=no
      [bloop] trace raw: app="Safari" titleLen=0 url=https://en.wikipedia.org/wiki/Study_skills nativeUrl=no
- PASS: A2: running app picks up the Automation grant without relaunch
  observation: Screen Recording still not granted in the running process (macOS caches it per process; needs relaunch)

## B: relaunch with permissions granted, drive real apps
  launched B via open (LaunchServices), pid(s): 24242 
  `[bloop] permissions: screen=granted automation=granted onboarding=false`
- PASS: B: Screen Recording reported granted after relaunch
- PASS: B: session auto-started
- PASS: B: welcome screen not reopened when everything is granted (browser running)

### 1-textedit
  frontmost after activating TextEdit: TextEdit
      [bloop] sample app="TextEdit" category=neutral score=100
      [bloop] sample app="TextEdit" category=neutral score=100
      [bloop] sample app="TextEdit" category=neutral score=100
      [bloop] sample app="TextEdit" category=neutral score=100
      [bloop] sample app="TextEdit" category=neutral score=100
      [bloop] sample app="TextEdit" category=neutral score=100
- PASS: TextEdit sampled as neutral

### 2-terminal
  frontmost after activating Terminal: Terminal
      [bloop] sample app="Terminal" category=focus score=100
      [bloop] sample app="Terminal" category=focus score=100
      [bloop] sample app="Terminal" category=focus score=100
      [bloop] sample app="Terminal" category=focus score=100
      [bloop] sample app="Terminal" category=focus score=100
      [bloop] sample app="Terminal" category=focus score=100
- PASS: Terminal sampled as focus
  score on Terminal: 100
- PASS: score is 100 after only focus time

### 3-youtube
  frontmost after activating Safari: Safari
      [bloop] sample app="Safari" domain=youtube.com category=distract score=57
      [bloop] nudge (distracted 18s)
      [bloop] pet says: "just a few more minutes of focus, okay?"
      [bloop] nudge notification
      [bloop] sample app="Safari" domain=youtube.com category=distract score=56
      [bloop] sample app="Safari" domain=youtube.com category=distract score=54
- PASS: Safari on YouTube sampled as distract (URL via AppleScript)
- PASS: pet turned worried after the nudge threshold
- PASS: nudge fired
  score after YouTube: 54
- PASS: score dropped below 100 on YouTube

### 4-wikipedia
  frontmost after activating Safari: Safari
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=64
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=65
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=65
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=66
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=66
      [bloop] sample app="Safari" domain=en.wikipedia.org category=focus score=67
- PASS: Safari on Wikipedia sampled as focus
- PASS: pet happy again after coming back
  score after Wikipedia: 67
- PASS: score recovered on Wikipedia

### permissions as seen by the running app (B)
  `[bloop] permissions(refresh): screen=granted automation=granted onboarding=false`
- PASS: B: Automation reported granted
- PASS: B: window titles readable (Screen Recording effective)

## Result: 0 failed assertion(s)
