# ASCII-FPS

터미널에서 돌아가는 작은 1인칭 ASCII 슈터입니다. `DOOM`/`Wolfenstein` 계열의 raycasting 진행감을 TUI로 옮긴 playable 데모입니다.

`terminal-kit`로 입력과 fullscreen 제어를 맡기고, 게임 로직과 장면 렌더링은 직접 구현합니다.

## 실행

터미널에서 앱 이름만으로 실행:

```bash
ascii-fps
```

저장소 안에서 직접 실행:

```bash
./ascii-fps
```

`pnpm` 스크립트로 실행:

```bash
pnpm start
```

전역으로 링크해서 명령어로 쓰고 싶다면:

```bash
pnpm link --global
ascii-fps
```

## 조작

- `W` / `S`: 전진 / 후진
- `↑` / `↓`: 전진 / 후진
- `A` / `D`: 좌우 이동
- `Q` / `E` 또는 `←` / `→`: 회전
- `Space` / `Enter`: 발사
- `R`: 사망 또는 승리 후 재시작
- `X`: 종료

## 특징

- ASCII raycasting 1인칭 시점
- ANSI 256-color 팔레트 기반 터미널 렌더링
- `terminal-kit` 기반 입력/화면 제어
- 적 추적 AI와 근접 공격
- 탄약 / 회복 픽업
- 미니맵, HUD, 무기 애니메이션

## 구조

- `src/main.js`: 터미널 초기화, 루프, 종료 처리
- `src/input.js`: `terminal-kit` 키 이벤트를 게임 입력 상태로 변환
- `src/game.js`: 이동, 충돌, 사격, 적 AI
- `src/render.js`: ANSI 버퍼 렌더링

## 테스트

```bash
pnpm test
```
