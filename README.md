# SOLE · Discord 커뮤니티 봇

> 이 프로젝트는 crew console korea에서 폐기된 프로젝트입니다.
> 추후 이 서비스가 비공개 될 수 있으며, 공개된 소스에 한해 라이선스를 주장하지 않습니다.

discord.js 14 + TypeScript + Discord Components V2로 구현한 봇입니다. `/command`에서 버튼으로 기능을 이용하고, 슬래시 명령어와 모달로 입력합니다. 티켓, 예약, 메시지 정리 진행 상태는 SQLite에 저장합니다.

## 시작하기

필요 환경: **Node.js 22.16 이상**, npm, TTS용 **FFmpeg**. 개발 검증 환경은 Node.js 22.22.2입니다. 이 버전에서는 내장 SQLite의 experimental 경고가 표시될 수 있습니다.

```bash
npm ci
cp .env.example .env
```

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱과 봇을 생성합니다.
2. `.env`에 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, 개발 서버의 `DISCORD_GUILD_ID`를 입력합니다. 토큰은 코드나 설정 JSON에 넣지 않습니다.
3. Bot → Privileged Gateway Intents에서 **Server Members Intent**, **Message Content Intent**를 켭니다. 각각 환영 인사/멤버 정보, 텍스트 채널 자동 TTS에 사용합니다.
4. OAuth2 초대 시 `bot`, `applications.commands` 범위를 선택하고 아래 기능별 권한을 부여합니다.
5. `config/bot.json`에서 채널·역할 ID와 기능의 `enabled`를 설정합니다. Discord 개발자 모드를 켜면 채널·역할·서버의 ID를 복사할 수 있습니다. ID는 반드시 **문자열**로 입력합니다.
6. 아래 명령을 실행합니다.

```bash
npm run validate
npm run deploy
npm run build
npm start
```

`npm run deploy`는 해당 앱의 명령어 목록을 등록합니다. `DISCORD_GUILD_ID`를 비우면 전역 등록합니다. 전역과 서버 등록 범위는 서로 별개이며, 기존 앱을 재사용하면 **선택한 범위의 기존 명령어 목록을 교체**합니다. 명령어 정의를 수정했을 때 다시 실행하세요. 이 환경 변수는 등록 범위만 결정하며 봇이 동작하는 서버를 제한하지 않습니다.

개발 중에는 `npm run dev`를 사용합니다. 실행 기준 경로는 프로젝트 루트입니다. 설정 파일만 수정했다면 봇 소유자가 `/settings reload`로 반영할 수 있습니다. `.env`를 바꾼 경우는 재시작합니다.

## 수정할 파일

| 파일 | 용도 |
| --- | --- |
| `config/bot.json` | 채널, 역할, 기능 활성화, 시간대, TTS 음성, 제한값 |
| `config/messages.json` | 패널, 버튼, 모달, 일반 응답 문구 |
| `.env` | 봇 토큰, 애플리케이션 ID, Google TTS 키, 저장 경로 |
| `src/commands/definitions.ts` | 슬래시 명령어 이름과 설명 |
| `src/features/` | 기능별 동작 코드 |
| `src/core/ui.ts` | 모든 Components V2 카드의 공통 모양 |

`config/messages.json`의 키 이름은 유지하고 값만 바꾸세요. 버튼은 80자, 모달 제목/입력 라벨은 45자 이내입니다. 새 문구 키를 추가하면 `src/core/message-keys.ts`도 확장합니다. 일부 운영 진단 오류와 명령어 설명은 소스에 있습니다.

`defaults`는 모든 서버의 기본값이고 `guilds`는 서버별 덮어쓰기입니다. 객체는 깊게 병합하고 배열은 통째로 교체합니다. 서버가 하나라면 `defaults`만 편집해도 됩니다. 설정 형식이 잘못되면 시작을 중단하며, `/settings reload` 실패 시 이전 설정을 유지합니다.

서버별 설정 예시 (`guilds` 안에 추가, 아래 ID는 실제 ID로 교체):

```json
{
  "123456789012345678": {
    "managerRoleIds": ["123456789012345679"],
    "logChannelId": "123456789012345680",
    "welcome": {
      "enabled": true,
      "channelId": "123456789012345681"
    },
    "tickets": {
      "enabled": true,
      "categoryId": "123456789012345682",
      "supportRoleIds": ["123456789012345683"]
    },
    "tts": {
      "enabled": true,
      "textChannelIds": ["123456789012345684"]
    },
    "moderation": {
      "enabled": true,
      "triggerChannelIds": ["123456789012345685"]
    }
  }
}
```

초기에는 채널 지정이 필요한 기능을 꺼두었습니다. 사용하려는 기능의 ID를 넣고 `enabled: true`로 바꾸세요. 예약 기능은 기본 활성화되며 관리자만 사용할 수 있습니다.

## 명령어

| 명령어 | 기능 | 사용자 권한 |
| --- | --- | --- |
| `/command` | 나에게만 보이는 V2 기능 패널 | 누구나 |
| `/welcome preview` | 현재 사용자를 기준으로 환영 인사 미리보기 | 관리자 |
| `/ticket panel` | 현재 채널에 공개 문의 패널 게시 | 관리자 |
| `/ticket open` | 제목·내용 입력 후 비공개 티켓 생성 | 누구나 |
| `/ticket close` | 현재 티켓의 종료 확인 화면 | 문의자·담당자·관리자 |
| `/tts join` | 사용자의 일반 음성 채널에 봇 입장 | TTS 허용 역할 |
| `/tts say [text]` | 읽기 대기열 추가; 내용 생략 시 모달 | 봇과 같은 음성 채널 |
| `/tts stop` | 현재 재생과 대기열 비우기 | 봇과 같은 음성 채널 |
| `/tts leave` | 봇 음성 연결 종료 | 봇과 같은 음성 채널 |
| `/schedule create channel:` | 날짜·메시지 입력 → 미리보기 → 예약 확정 | 관리자 |
| `/schedule list` | 최근 10건 및 취소 버튼 | 관리자 |
| `/schedule cancel id:` | 대기 예약 취소 | 관리자 |
| `/moderation status` | 최근 5건의 차단·정리 진행 상태 | 관리자 |
| `/settings show` | 서버 설정 요약 | 관리자 |
| `/settings reload` | 설정·문구 다시 불러오기 | 관리자이면서 봇 소유자 |

여기서 관리자는 `서버 관리(Manage Guild)` 권한 또는 `managerRoleIds`에 지정된 역할을 가진 사람입니다. 별도의 명령어 기본 권한 제한을 걸지 않아 지정 역할도 사용할 수 있습니다. 모든 관리 작업은 실행 시 권한을 검사하며, 예약은 전송 직전에도 작성자의 현재 역할과 채널 접근 권한을 검사합니다.

봇 소유자는 Discord 애플리케이션 소유자(팀이면 팀 소유자)입니다. `.env`의 `BOT_OWNER_IDS`에 쉼표로 구분한 운영자 ID를 추가할 수 있습니다. 전체 설정 반영이므로 새로고침 시 모든 TTS 연결을 종료합니다. 기존 티켓 메시지/게시된 패널은 자동 수정하지 않으며, 새로 생성하는 화면부터 변경된 문구를 사용합니다.

## 기능 설정

### 1. 환영 인사

`welcome.channelId`에 입장 메시지를 전송합니다. `title`, `body`에는 `{user}`(멘션), `{username}`, `{server}`, `{memberCount}`를 사용할 수 있습니다. `imageUrl`에는 HTTPS 이미지 주소를 지정합니다. `autoRoleIds`의 역할을 입장 시 자동 부여합니다. 미리보기는 역할을 부여하지 않습니다.

### 2. 문의 티켓

`tickets.categoryId` 아래 텍스트 채널을 생성합니다. 문의자, 봇, `supportRoleIds`, `managerRoleIds`에만 채널 보기 권한을 허용합니다. Discord의 서버 관리자 권한은 채널 제한을 우회합니다. 서버 관리 권한만 가진 일반 운영자도 티켓을 보려면 담당/관리 역할로 지정해 주세요.

- `channelName`: `{username}`, `{number}` 사용 가능. `intro`: `{user}` 사용 가능.
- `maxOpenPerUser`: 사용자별 진행 중인 티켓 수 제한. 동시 클릭도 검사합니다.
- `closeDeletesChannel: false`: 종료 시 문의자 메시지 전송을 차단하고 채널을 `closed-...`로 변경해 대화를 보존합니다. 담당자는 계속 확인할 수 있습니다.
- `closeDeletesChannel: true`: 종료 확인 시 채널과 대화를 삭제합니다. 별도 transcript 내보내기는 제공하지 않습니다.

새 채널의 주제(`sole-ticket:...`)는 생성 중 재시작 시 복구에 사용하므로 유지하세요. 종료된 채널이 보존되는 기본 설정에서는 서버 채널 수에 맞게 운영자가 정리하면 됩니다.

### 3. 음성 TTS

[Google Cloud Text-to-Speech](https://docs.cloud.google.com/text-to-speech/docs/get-started)를 활성화한 프로젝트에서 키를 발급해 `.env`의 `GOOGLE_TTS_API_KEY`에 입력합니다. 사용량에 따른 비용과 할당량은 해당 Google Cloud 프로젝트에 적용됩니다. API 제한은 Cloud Text-to-Speech로, 필요하면 서버 IP 제한도 설정하세요. 이 구현은 `X-Goog-Api-Key` 헤더로 요청합니다.

로컬 실행은 `ffmpeg`를 PATH에 설치해야 합니다. Docker 이미지에는 포함되어 있습니다. MP3 합성 → FFmpeg 변환 → Opus 전송 순서로 재생합니다. `@discordjs/voice`에 포함된 DAVE 라이브러리를 사용합니다.

1. 일반 음성 채널에 입장하고 `/tts join`을 실행합니다.
2. `/tts say text:안녕하세요` 또는 패널의 읽기 버튼을 사용합니다.
3. `textChannelIds`가 지정되어 있다면 그 채널의 새 메시지도 읽습니다. 작성자가 봇과 같은 음성 채널에 있어야 합니다.

`allowedRoleIds`가 비어 있으면 누구나 이용할 수 있습니다. `languageCode`, `voiceName`, `speakingRate`, 최대 글자 수·대기열·쿨다운·유휴 퇴장 시간을 설정할 수 있습니다. 기본 음성은 한국어 `ko-KR-Standard-A`입니다. 텍스트는 Google에 음성 합성을 위해 전송되고 음성 파일은 디스크에 저장하지 않습니다. URL/멘션/이모지 문법은 정리합니다.

봇당 서버별 음성 연결은 하나입니다. 기존 연결과 다른 음성 채널에서는 제어할 수 없습니다. 스테이지 채널은 지원하지 않습니다. 텍스트 채널 자동 읽기의 역할/글자 수/쿨다운 위반은 조용히 건너뛰며, `/tts say`는 이유를 표시합니다. API/재생 실패는 로그 채널과 콘솔에 기록합니다. 음성 연결과 대기열은 재시작하면 초기화됩니다.

다른 합성 서비스는 `src/features/tts.ts`의 `SpeechProvider` 인터페이스를 구현하고 `src/index.ts`의 생성자를 교체하면 됩니다.

### 4. 금지 채널 자동 차단·메시지 삭제

`moderation.triggerChannelIds`에 일반 사용자가 메시지를 보내면 **차단으로 서버 퇴장과 재입장 차단을 함께 처리**합니다. `includeChildThreads: true`이면 지정 채널의 하위 스레드에도 적용합니다. 봇과 웹훅, 서버 소유자는 제외합니다. 기본값은 서버 관리자도 제외하며, `exemptAdministrators`, `exemptUserIds`, `exemptRoleIds`로 바꿀 수 있습니다.

차단에 성공하면 `deleteMessageSeconds`에 해당하는 최근 메시지를 Discord가 삭제합니다. API의 최대 범위는 604800초(7일)입니다. `scanHistory: true`이면 이후 서버 내 조회 가능한 채널과 스레드의 전체 메시지 기록을 100개씩 읽고 해당 작성자의 메시지만 개별 삭제합니다. 개별 삭제이므로 14일 이전 메시지도 처리합니다. [Discord 차단 API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx), [메시지 삭제 API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx).

`includeArchivedThreads`는 보관된 공개/비공개 스레드와 포럼 게시물도 탐색합니다. 비공개 스레드 전체 탐색과 잠긴 보관 스레드 관리는 `Manage Threads` 권한이 필요합니다. 권한이 없으면 참여한 비공개 보관 스레드만 검사하고 누락 사유를 남깁니다. [Discord 스레드 권한·조회 규칙](https://github.com/discord/discord-api-docs/blob/main/developers/topics/threads.mdx).

**모든 메시지 삭제 범위는 이 서버에서 봇이 읽고 삭제할 수 있는 기록입니다.** 다른 서버·DM·접근할 수 없는 채널은 처리할 수 없습니다. 삭제 수는 봇이 직접 삭제한 건수이며 차단 API가 삭제한 수는 포함하지 않습니다. 기록이 큰 서버는 시간이 걸리고 Discord의 요청 제한에 따라 느려질 수 있습니다. 누락/실패는 `/moderation status`, 로그 채널 및 SQLite 작업의 `issues`에 남습니다(상세 최대 200건).

작업은 채널별 커서를 저장하여 재시작 후 이어갑니다. 메시지 삭제 실패는 기록 후 계속하고 채널 접근 실패는 3회 후 건너뜁니다. 차단 실패 시 기록 삭제를 시작하지 않습니다. 이미 시작된 차단/정리 작업은 시작 당시 설정으로 계속되며 `enabled: false`는 새 감지만 중단합니다. 봇이 오프라인일 때 발생한 메시지나 기존 메시지 편집은 자동 감지 대상이 아닙니다.

### 5. 메시지 예약

`/schedule create channel:#공지` → `YYYY-MM-DD HH:mm` 및 본문 입력 → 미리보기의 **예약 확정**을 누릅니다. 기본 시간대는 `Asia/Seoul`이고 서버의 `timezone`을 변경할 수 있습니다. 존재하지 않거나 중복되는 DST 시각은 거부합니다. Discord의 시각 표시는 보는 사람의 현지 시간대에 맞춰 표시됩니다.

- 본문 최대 3000자. 확정 전 초안은 15분 후 만료됩니다.
- `allowedChannelIds: []`는 작성자와 봇이 전송 가능한 채널을 허용합니다. 배열을 채우면 해당 채널만 허용합니다.
- `pollIntervalSeconds`는 서버별 확인 간격이며 기본 10초입니다. 초 단위 정시 전송을 보장하는 시스템은 아닙니다.
- 봇이 꺼져 있던 동안 지난 예약은 재시작 후 전송합니다. 기능을 끈 동안의 예약은 대기하며 다시 켜면 처리합니다.
- 재시도 가능한 전송 전 오류나 명시적 429만 제한 횟수 안에서 재시도합니다. 권한 오류 등은 실패 처리합니다.
- 전송 요청 중 연결이 끊기거나 프로세스가 종료되면 `전송 여부 확인 필요`로 표시하고 자동 재전송하지 않습니다. 해당 채널에서 수신 여부를 확인하고 필요하면 새로 예약하세요. 전송 시 nonce도 사용하지만 Discord가 영구적인 정확히 한 번 전송을 보장하지는 않습니다.
- 이 구현은 **일회성 예약**입니다. 반복 예약과 첨부파일 예약은 포함하지 않습니다.

예약과 일반 패널은 `@everyone`, 역할, 사용자 멘션 알림을 보내지 않습니다. 환영 인사만 새로 들어온 사용자를 알립니다. 모든 봇 화면은 Components V2로 전송합니다. [V2 메시지 제약](https://discordjs.guide/popular-topics/components-v2).

## 봇에 필요한 권한

| 기능 | 봇 권한 |
| --- | --- |
| 공통 | 채널 보기, 메시지 보내기, 메시지 기록 보기 |
| 환영 자동 역할 | 역할 관리, 부여할 역할보다 높은 봇 역할 |
| 티켓 | 카테고리의 채널 보기·채널 관리·역할 관리, 메시지 보내기, 메시지 기록 보기 |
| TTS | 음성 채널 보기, 연결, 말하기 |
| 자동 차단 | 멤버 차단, 대상 멤버의 최상위 역할보다 높은 봇 역할 |
| 기록 삭제 | 각 채널의 채널 보기·메시지 기록 보기·메시지 관리 |
| 비공개/잠긴 스레드 정리 | 스레드 관리 |
| 스레드 예약 | 스레드에서 메시지 보내기, 비공개 스레드 접근 권한 |

예약 시 대상 스레드는 활성 상태여야 합니다. 봇이 접근할 수 없는 채널 ID, 상위/동급 역할 대상 차단, 자동 부여할 수 없는 관리형 역할은 오류가 됩니다.

## 운영 및 검증

```bash
npm run check
npm test
npm run validate
npm run build
```

테스트는 외부 API에 연결하지 않고 설정 병합, Components V2 직렬화, 예약 권한·중복·복구·취소 경쟁 상태, 메시지 전체 기록 순회, 티켓 복구·권한, TTS 중지 경쟁 상태 등을 검증합니다. `validate`는 키 값 자체를 출력하지 않고 설정 여부와 음성 의존성을 확인합니다. 실제 Discord API와 음성 송수신 검증은 토큰과 테스트 서버가 필요합니다.

Docker 실행:

```bash
docker compose up -d --build
docker compose logs -f bot
```

명령어 등록은 호스트의 `npm run deploy`로 먼저 수행합니다. 컨테이너는 `.env`와 읽기 전용 `config/`, 영속 볼륨 `sole-data`를 사용합니다. Docker에서도 `BOT_CONFIG_PATH`, `BOT_MESSAGES_PATH`, `BOT_DATABASE_PATH`는 기본값을 유지하면 됩니다.

**봇 프로세스는 한 개만 실행하세요.** SQLite 저장소와 작업 처리기는 단일 인스턴스용이며 여러 프로세스/컨테이너가 같은 DB로 동작하는 분산 실행은 지원하지 않습니다. 데이터 백업은 봇을 정상 종료한 뒤 `data/` 전체 또는 Docker 볼륨을 복사합니다. 로그 및 처리 완료 레코드는 자동 삭제하지 않으므로 운영 보관 정책에 따라 DB를 백업·정리하세요.

실제 서버 점검 순서:

1. `/command`, `/welcome preview`로 화면과 문구를 확인합니다.
2. `/ticket panel`에서 테스트 티켓을 열고 일반 멤버의 비공개 여부와 종료 권한을 확인합니다.
3. 음성 채널에서 `/tts join`, `/tts say`, `/tts stop`, `/tts leave`를 확인합니다.
4. 몇 분 뒤 공지를 예약하고 취소/재시작 후 유지 여부를 확인합니다.
5. 금지 채널은 전용 테스트 계정으로 확인하고 `/moderation status`에서 과거 기록 삭제와 권한 누락을 확인합니다.

## 코드 구조

```text
config/                 기능 설정과 사용자 문구
src/
  index.ts              이벤트 연결, 시작·정상 종료
  deploy.ts             슬래시 명령어 등록
  validate.ts           로컬 설정·의존성 점검
  commands/
    definitions.ts      명령어 정의
    router.ts           명령어·버튼·모달 라우팅
  core/
    config.ts           스키마 검증, 서버별 병합, 템플릿
    store.ts            SQLite 저장소
    permissions.ts      권한 및 전송 채널 검증
    ui.ts               Components V2 공통 UI
    audit.ts            콘솔·채널 로그
  features/
    welcome.ts          환영 인사·자동 역할
    tickets.ts          문의 생성·종료·복구
    tts.ts              합성 서비스·음성 연결·대기열
    moderation.ts       자동 차단·영속 메시지 정리
    schedules.ts        예약 상태·재시도·복구
tests/                  외부 API 없는 자동 테스트
```
