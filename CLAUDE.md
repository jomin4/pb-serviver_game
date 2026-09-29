# CLAUDE.md

## 개발 워크플로우 규칙

새 기능은 항상 brainstorming 스킬로 시작 → 설계 승인 후 writing-plans → TDD로 구현

1. **brainstorming** — 새 기능은 반드시 `brainstorming` 스킬로 시작해 요구사항과 설계를 정리한다.
2. **설계 승인** — 사용자가 설계를 승인하기 전에는 다음 단계로 넘어가지 않는다.
3. **writing-plans** — 승인된 설계를 바탕으로 `writing-plans` 스킬로 구현 계획을 작성한다.
4. **TDD 구현** — `test-driven-development` 스킬에 따라 실패하는 테스트를 먼저 작성한 뒤 구현한다.

## 스킬

`.claude/skills/`의 스킬은 [obra/superpowers](https://github.com/obra/superpowers)
(커밋 `8ca22db`)의 `skills/` 폴더에서 가져왔다. 라이선스: MIT (`.claude/skills/LICENSE-superpowers`).
