import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

type Debug = { selfId: string | null; getState(): unknown };
type PlayerJson = { x: number; y: number };
type StateJson = { players?: Record<string, PlayerJson> } | null;

/** 브라우저 안의 디버그 훅(`?debug=1`)에서 특정 플레이어의 x를 읽는다. 아직 없으면 null. */
async function playerX(page: Page, id: string): Promise<number | null> {
  return page.evaluate((who) => {
    const dbg = (window as unknown as { __bhDebug?: Debug }).__bhDebug;
    const state = dbg?.getState() as StateJson;
    return state?.players?.[who]?.x ?? null;
  }, id);
}

async function selfId(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bhDebug?: Debug }).__bhDebug?.selfId ?? null)).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __bhDebug: Debug }).__bhDebug.selfId as string);
}

/** 두 명이 모여 시작한 게임 화면을 만든다. 반환한 페이지는 둘 다 게임 화면이다. */
async function startTwoPlayerGame(browser: Browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/?debug=1');
  await a.getByTestId('nickname-input').fill('가');
  await a.getByTestId('create-button').click();
  const link = await a.getByTestId('invite-link').inputValue();

  await b.goto(`${link}&debug=1`);
  await b.getByTestId('nickname-input').fill('나');
  await b.getByTestId('join-button').click();

  for (const page of [a, b]) {
    const names = page.getByTestId('player-list').getByTestId('player-item');
    await expect(names).toHaveCount(2);
    await expect(page.getByTestId('player-list')).toContainText('가');
    await expect(page.getByTestId('player-list')).toContainText('나');
  }
  return { a, b, ctxA, ctxB };
}

test('두 명이 링크로 모여 라운드를 시작하고 움직인다', async ({ browser }) => {
  const { a, b, ctxA, ctxB } = await startTwoPlayerGame(browser);
  try {
    await a.screenshot({ path: 'test-results/lobby.png' });

    await a.getByTestId('start-button').click();
    for (const page of [a, b]) {
      await expect(page.getByTestId('game-screen')).toBeVisible();
      await expect(page.getByTestId('hud-clock')).toHaveText(/^00:0/);
    }

    const idA = await selfId(a);
    await expect.poll(() => playerX(b, idA)).not.toBeNull();
    const before = (await playerX(b, idA)) as number;

    await a.keyboard.down('KeyD');
    await a.waitForTimeout(1000);
    await a.keyboard.up('KeyD');

    await expect.poll(async () => ((await playerX(b, idA)) ?? before) - before, { timeout: 10_000 }).toBeGreaterThan(0.5);
    await a.screenshot({ path: 'test-results/game-a.png' });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('없는 방 코드는 안내 문구를 보여 준다', async ({ page }) => {
  await page.goto('/?room=ABCDEF&debug=1');
  await page.getByTestId('nickname-input').fill('가');
  await page.getByTestId('join-button').click();
  await expect(page.getByTestId('error-text')).toHaveText('방을 찾을 수 없습니다. 코드를 확인해 주세요');
});

test('게임 중 Esc로 메뉴가 열린다', async ({ browser }) => {
  const { a, ctxA, ctxB } = await startTwoPlayerGame(browser);
  try {
    await a.getByTestId('start-button').click();
    await expect(a.getByTestId('game-screen')).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(a.getByTestId('menu')).toBeVisible();
    await expect(a.getByTestId('menu-leave')).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
