import { it, expect } from "vitest";

it("UI 模块图可加载（导入冒烟，不渲染 DOM）", async () => {
  const app = await import("../../ui/App");
  const pages = await import("../../ui/Pages");
  const create = await import("../../ui/Create");
  const settle = await import("../../ui/Settlement");
  expect(typeof app.default).toBe("function");
  expect(typeof pages.OverviewPage).toBe("function");
  expect(typeof pages.MarketPage).toBe("function");
  expect(typeof pages.MenuPage).toBe("function");
  expect(typeof pages.ResearchPage).toBe("function");
  expect(typeof pages.StaffPage).toBe("function");
  expect(typeof pages.DecorPage).toBe("function");
  expect(typeof pages.CityPage).toBe("function");
  expect(typeof pages.FinancePage).toBe("function");
  expect(typeof create.CreateScreen).toBe("function");
  expect(typeof settle.SettlementModal).toBe("function");
});
