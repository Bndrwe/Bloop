# Bloop macOS e2e (macOS 14.8.9, arm64, runner GitHub Actions 1000001843)

App: `/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app` (bundle id edu.bloop.app)

## A: launch without permissions
  launched A via open (LaunchServices), pid(s): 21043 
  `[bloop] permissions: screen=denied automation=unknown onboarding=true`
  last refresh: `[bloop] permissions(refresh): screen=denied automation=unknown onboarding=true`
- PASS: A: app started and logged its permission state
- PASS: A: Screen Recording is NOT reported granted before the grant
- PASS: A: session auto-started
- PASS: A: real active-window samples are being taken
  sample lines (last 3):
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null

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
      kTCCServiceScreenCapture|edu.bloop.app|0|2|4|UNUSED||
      kTCCServiceScreenCapture|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|UNUSED||
      kTCCServiceAppleEvents|edu.bloop.app|0|2|4|com.apple.Safari||44
      kTCCServiceAppleEvents|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|com.apple.Safari||44
      --- rows for Bloop in /Users/runner/Library/Application Support/com.apple.TCC/TCC.db
      service|client|client_type|auth_value|auth_reason|indirect_object_identifier|csreq_len|ind_req_len
      kTCCServiceScreenCapture|edu.bloop.app|0|2|4|UNUSED||
      kTCCServiceScreenCapture|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|UNUSED||
      kTCCServiceAppleEvents|edu.bloop.app|0|2|4|com.apple.Safari||44
      kTCCServiceAppleEvents|/Users/runner/work/StudyPet/StudyPet/dist/mac-arm64/Bloop.app/Contents/MacOS/Bloop|1|2|4|com.apple.Safari||44
  frontmost after activating Safari: Safari
  refresh after grant: `[bloop] permissions(refresh): screen=denied automation=granted onboarding=true`
      [bloop] automation permission -> granted
- PASS: A2: running app picks up the Automation grant without relaunch
  observation: Screen Recording still not granted in the running process (macOS caches it per process; needs relaunch)

## B: relaunch with permissions granted, drive real apps
  launched B via open (LaunchServices), pid(s): 22639 
  `[bloop] permissions: screen=granted automation=unknown onboarding=true`
- PASS: B: Screen Recording reported granted after relaunch
- PASS: B: session auto-started

### 1-textedit
  frontmost after activating TextEdit: TextEdit
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
- **FAIL**: TextEdit sampled as neutral

### 2-terminal
  frontmost after activating Terminal: Terminal
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
- **FAIL**: Terminal sampled as focus
  score on Terminal: 
- **FAIL**: score is 100 after only focus time

### 3-youtube
  frontmost after activating Safari: Safari
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
- **FAIL**: Safari on YouTube sampled as distract (URL via AppleScript)
- **FAIL**: pet turned worried after the nudge threshold
- **FAIL**: nudge fired
  score after YouTube: 
- **FAIL**: score dropped below 100 on YouTube

### 4-wikipedia
  frontmost after activating Safari: Safari
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
      [bloop] sample app="Unknown" category=neutral score=null
- **FAIL**: Safari on Wikipedia sampled as focus
- **FAIL**: pet happy again after coming back
  score after Wikipedia: 
- **FAIL**: score recovered on Wikipedia

### permissions as seen by the running app (B)
  `[bloop] permissions(refresh): screen=granted automation=granted onboarding=false`
- PASS: B: Automation reported granted
- **FAIL**: B: window titles readable (Screen Recording effective)

## Result: 11 failed assertion(s)
