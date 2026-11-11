// 突发事件引擎：条件/概率/冷却/选项效果/后续/冷却/历史；事件都归属到某城市分店，效果落在该分店
import type { Branch, GameState, PendingEvent, ReviewItem } from "../types";
import { ALL_SLOTS } from "../types";
import { EVENTS, BLOGGER, INTERVIEW, TYCOON, getMods, STORY_EVENTS, DEMAND } from "../config";
import { toCnyCents, toLocalCents, CITY_BY_ID } from "../data/cities";
import { chance, rndInt, rndPick, nextRandom } from "../rng";
import { clamp, qtyText } from "../utils";
import { marketShock, purchase } from "./market";
import { ING_BY_ID } from "../data/ingredients";
import { DISH_BY_ID } from "../data/dishes";
import { consumePartial, cookDish, marketCogsOfDish } from "./inventory";
import { ROLE_NAMES } from "./staff";

export const BLOGGER_NAMES = ["辣味雷达", "长街食探", "干饭日记", "都市胃地图", "深夜食堂酱", "阿豪吃遍城", "觅食小雷达", "老饕笔记", "今天吃什么", "吃货大冒险"];

function homeBranch(s: GameState): Branch {
  return s.branches["changsha"] ?? Object.values(s.branches)[0];
}

export function totalCashCny(s: GameState): number {
  let t = 0;
  for (const b of Object.values(s.branches)) t += toCnyCents(b.cashCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
  return t;
}

// ---------------- 采访题库（隐藏分数） ----------------
export interface InterviewOption { id: string; label: string; score: number; special?: "lie" | "cold" | "complain" }
export interface InterviewQuestion {
  id: string; text: string;
  options: InterviewOption[];
  bgScoped?: boolean;
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "q_years", text: "干了多久了？",
    options: [
      { id: "q_years_honest", label: "如实回答", score: 1 },
      { id: "q_years_lie", label: "谎称比实际多二十年", score: 3, special: "lie" },
    ],
  },
  {
    id: "q_why", text: "为什么选择做餐饮？", bgScoped: true,
    options: [
      { id: "q_why_miserable", label: "讲述身世，卖惨", score: 5 },
      { id: "q_why_normal", label: "想赚钱", score: 2 },
      { id: "q_why_affluent", label: "想锻炼自己", score: 1 },
      { id: "q_why_tycoon", label: "下凡体验生活", score: 3 },
      { id: "q_why_cold", label: "保持高冷装神秘", score: -1, special: "cold" },
    ],
  },
  {
    id: "q_soup", text: "高汤是每天现熬的还是秘方？",
    options: [
      { id: "q_soup_self", label: "当然是自己熬的", score: 2 },
      { id: "q_soup_staff", label: "店员熬的", score: 3 },
    ],
  },
  {
    id: "q_peak", text: "什么时间段人最多？",
    options: [
      { id: "q_peak_am", label: "上午", score: 1 },
      { id: "q_peak_noon", label: "中午", score: 1 },
      { id: "q_peak_pm", label: "下午", score: 1 },
      { id: "q_peak_evening", label: "晚上", score: 1 },
      { id: "q_peak_midnight", label: "半夜", score: 1 },
      { id: "q_peak_bad", label: "生意不好啊", score: 2 },
      { id: "q_peak_great", label: "一直都挺好的", score: 3 },
    ],
  },
  {
    id: "q_challenge", text: "开这家店遇到过最大的挑战是什么？",
    options: [
      { id: "q_cha_none", label: "没有挑战", score: 1 },
      { id: "q_cha_tough", label: "什么都能打倒我", score: 2 },
      { id: "q_cha_complain", label: "抱怨客人", score: -10, special: "complain" },
    ],
  },
  {
    id: "q_name", text: "店名有什么特殊含义？",
    options: [
      { id: "q_name_wife", label: "孩子她娘喜欢", score: 3 },
      { id: "q_name_mom", label: "这是妈妈的愿望", score: 3 },
      { id: "q_name_ai", label: "豆包帮我生成一个饭馆店名", score: 1 },
      { id: "q_name_yummy", label: "看起来很好吃的样子", score: 2 },
    ],
  },
];

export const INTERVIEW_BY_ID: Record<string, InterviewQuestion> = Object.fromEntries(INTERVIEW_QUESTIONS.map((q) => [q.id, q]));

export function computeInterviewScore(questionIds: string[], answerIds: string[], openDays: number): number {
  let score = 0;
  for (let i = 0; i < questionIds.length; i++) {
    const q = INTERVIEW_BY_ID[questionIds[i]];
    const ans = answerIds[i];
    if (!q || !ans) continue;
    const opt = q.options.find((o) => o.id === ans);
    if (!opt) continue;
    if (ans === "q_years_honest") score += openDays >= 3650 ? 2 : 1;
    else score += opt.score;
  }
  return score;
}

function pickInterviewQuestions(s: GameState): string[] {
  const pool = INTERVIEW_QUESTIONS.map((q) => q.id);
  const picked: string[] = [];
  let guard = 0;
  while (picked.length < 3 && guard++ < 30) {
    const id = rndPick(s, pool);
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

// ---------------- 事件定义 ----------------
export interface EventDefFull {
  id: string;                    // 唯一事件ID
  title: string;                 // 标题
  desc: string;                  // 正文
  type: string;                  // 事件类型
  probBp: number;                // 触发概率（基点；0=仅由后续/调度触发）
  probFor?: (s: GameState, b: Branch) => number; // 动态触发概率（优先于 probBp）
  cooldownDays: number;          // 重复触发冷却（天）
  blocking: boolean;             // 未处理是否阻塞该店确认营业
  once?: boolean;                // 是否仅一次（默认允许重复触发）
  defaultOptionId?: string;      // 逾期未处理的被动选项
  condition?: (s: GameState, b: Branch) => boolean;
  build: (s: GameState, b: Branch, pre?: Record<string, number | string>) => { data: Record<string, number | string>; options: { id: string; label: string; payloadKey?: string }[] };
}

function signatureDishId(s: GameState, b: Branch): string {
  const act = Object.values(b.menu).filter((m) => m.active);
  if (act.length === 0) return "la_jiao_chao_rou";
  const last = b.reports[0];
  if (last && last.dishStats.length > 0) return last.dishStats[0].dishId;
  return act[0].dishId;
}

function anyFreshIngId(s: GameState): string {
  const cand = Object.values(ING_BY_ID).filter((i) => i.shelfDays <= 10);
  return rndPick(s, cand).id;
}

export const EVENT_DEFS: EventDefFull[] = [
  {
    id: "bug_complaint", type: "投诉", title: "顾客声称吃到虫子", probBp: 900, cooldownDays: 12, blocking: true,
    desc: "一位顾客举着餐盒大喊吃到了虫子，周围几桌都在看。",
    condition: (s, b) => b.store.hygiene < 85 || chance(s, 3000),
    build: (s, b) => {
      const dishId = signatureDishId(s, b);
      const price = b.menu[dishId]?.priceCents ?? 3000;
      return {
        data: { dishId, priceCents: price, tenfold: chance(s, EVENTS.complaintPayChanceBp) ? 1 : 0 },
        options: [
          { id: "pay_full", label: `全款赔偿（先赔 ${price * 2} 分，若证据不利可能十倍）` },
          { id: "deny", label: "拒绝承认" },
          { id: "suspend", label: "暂停相关菜品并全面检查" },
        ],
      };
    },
  },
  {
    id: "blogger_dropin", type: "博主", title: "探店博主突然到店", probBp: 850, cooldownDays: 8, blocking: false, defaultOptionId: "normal",
    desc: "一个举着手机的人径直走进店里，说是来做一期探店。",
    build: (s) => {
      const followers = rndInt(s, BLOGGER.followerMin, BLOGGER.followerMax);
      return {
        data: {
          name: rndPick(s, BLOGGER_NAMES), followers, matchBp: rndInt(s, 3000, 9000), quality: rndInt(s, 30, 95),
          persistent: followers >= BLOGGER.persistentFollowerMin ? 1 : 0,
        },
        options: [
          { id: "normal", label: "正常出餐" },
          { id: "extra", label: "加量接待（多耗50%食材）" },
          { id: "gift", label: "赠送招牌菜" },
          { id: "meal", label: "提供博主套餐" },
          { id: "refuse", label: "拒绝特殊接待" },
        ],
      };
    },
  },
  {
    id: "interview_visitor", type: "博主", title: "采访博主到店", probBp: 500, cooldownDays: 18, blocking: true,
    desc: "本地美食栏目想拍一期小店老板专访，三个问题随机提问。",
    build: (s) => {
      const qs = pickInterviewQuestions(s);
      return {
        data: {
          name: rndPick(s, BLOGGER_NAMES), followers: rndInt(s, 2000, 80000), matchBp: rndInt(s, 4000, 9000),
          q0: qs[0], q1: qs[1], q2: qs[2],
        },
        options: [{ id: "answer", label: "接受采访并回答", payloadKey: "answers" }],
      };
    },
  },
  {
    id: "price_spike", type: "市场", title: "原材料涨价/缺货", probBp: 800, cooldownDays: 6, blocking: false, defaultOptionId: "wait",
    desc: "供应商群炸锅了，某种食材行情突变。",
    build: (s) => {
      const ingId = anyFreshIngId(s);
      const short = chance(s, 3500);
      return {
        data: {
          ingId, name: ING_BY_ID[ingId].name,
          shockBp: rndInt(s, 11500, 14000), days: rndInt(s, 2, 4), short: short ? 1 : 0,
          depositCents: 20000, buyPremiumBp: 1100,
        },
        options: [
          { id: "deposit", label: "付定金锁定保供价（定金200元）" },
          { id: "buy_now", label: "现溢价10%从散户调货" },
          { id: "wait", label: "等行情回落" },
        ],
      };
    },
  },
  {
    id: "equip_failure", type: "设备", title: "设备故障", probBp: 650, cooldownDays: 10, blocking: false, defaultOptionId: "degraded",
    desc: "后厨传来异响，一台主力设备罢工了。",
    condition: (s, b) => b.store.equipmentHealth > 25,
    build: () => ({
      data: { repairMin: 80000, repairMax: 400000, replaceCents: 900000 },
      options: [
        { id: "repair", label: "立即维修（800~4000元）" },
        { id: "degraded", label: "带病运转" },
        { id: "replace", label: "直接换新（约9000元）" },
      ],
    }),
  },
  {
    id: "staff_resign", type: "员工", title: "核心员工提出离职", probBp: 500, cooldownDays: 15, blocking: true,
    desc: "骨干把你拉到后厨，说家里有事/外面有更好的机会。",
    condition: (s, b) => b.staff.some((e) => (e.role === "cook" || e.role === "manager") && b.staff.length >= 2),
    build: (s, b) => {
      const e = b.staff.filter((x) => x.role === "cook").sort((a, c) => c.skill - a.skill)[0] ?? b.staff[0];
      return {
        data: { empId: e.id, name: e.name, role: ROLE_NAMES[e.role], wageCents: e.baseWageCents },
        options: [
          { id: "raise", label: `加薪30%挽留（约+${Math.round(e.baseWageCents * 0.3)}分/日）` },
          { id: "talk", label: "谈心了解真实原因（效果看忠诚）" },
          { id: "letgo", label: "放行，不送" },
        ],
      };
    },
  },
  {
    id: "competitor_open", type: "竞争", title: "隔壁竞争店开业", probBp: 350, cooldownDays: 40, blocking: false, once: true, defaultOptionId: "ignore",
    desc: "斜对面新开了家同品类，装修很网红，还在打折。",
    build: () => ({
      data: {},
      options: [
        { id: "price_war", label: "跟进价格战（促销费200元，客流-5%）" },
        { id: "quality", label: "死磕品质与卫生（500元，客流-2%）" },
        { id: "ignore", label: "无视（未来14天客流-12%）" },
      ],
    }),
  },
  {
    id: "long_queue", type: "运营", title: "顾客大量排队", probBp: 900, cooldownDays: 5, blocking: false, defaultOptionId: "limit",
    desc: "门口排起了长队，等待时间快超顾客耐心了。",
    condition: (s, b) => (b.reports[0]?.lostToWait ?? 0) > (b.reports[0]?.served ?? 0) / 2,
    build: () => ({
      data: {},
      options: [
        { id: "open_all", label: "全时段加开（今日营业时段拉满）" },
        { id: "free_tea", label: "发饮品安抚排队顾客（200元）" },
        { id: "limit", label: "限流赶客" },
      ],
    }),
  },
  {
    id: "bad_review_spread", type: "舆情", title: "负面评价传播", probBp: 700, cooldownDays: 10, blocking: false, defaultOptionId: "apologize",
    desc: "几条差评被同城号合集转发了，评论区在带节奏。",
    condition: (s, b) => b.reviews.slice(0, 30).filter((r) => r.score <= 2).length >= 3,
    build: () => ({
      data: {},
      options: [
        { id: "apologize", label: "公开道歉并整改（300元，卫生+10，口碑+15）" },
        { id: "pr", label: "投放公关稿（800元，口碑+8）" },
        { id: "fight", label: "回怼网友（五五开）" },
      ],
    }),
  },
  {
    id: "supplier_default", type: "供应商", title: "供应商临时违约", probBp: 450, cooldownDays: 12, blocking: false, defaultOptionId: "switch",
    desc: "已付款的明日配送被单方面取消。",
    condition: (s, b) => b.pendingDeliveries.length > 0,
    build: () => ({
      data: {},
      options: [
        { id: "claim", label: "按合同索赔" },
        { id: "switch", label: "认栽，换供应商" },
        { id: "blacklist", label: "拉黑并自提（加价20%）" },
      ],
    }),
  },
  {
    id: "vip_request", type: "熟客", title: "熟客提出特殊要求", probBp: 600, cooldownDays: 8, blocking: false, defaultOptionId: "decline",
    desc: "一位老会员想包个小间办家宴，希望你定制菜单。",
    condition: (s, b) => b.regulars >= 10,
    build: () => ({
      data: {},
      options: [
        { id: "accept", label: "接下定制单（成本500元，回头客+5）" },
        { id: "decline", label: "婉拒（口碑-2）" },
      ],
    }),
  },
  {
    id: "expiry_alarm", type: "损耗", title: "食材过期提醒", probBp: 9999, cooldownDays: 0, blocking: false, defaultOptionId: "ignore",
    desc: "冷柜里又翻出了过期食材：扔了心疼，卖出去缺德程度也有限——你决定怎么办？（每天都会检查，不处理会继续累积）",
    condition: (s, b) => b.pendingSpoilage.length > 0,
    build: (s, b) => {
      let v = 0;
      const names: string[] = [];
      const parts: string[] = [];
      for (const l of b.pendingSpoilage) {
        v += Math.round((l.qty * l.unitPriceCents) / l.perPurchase);
        const def = ING_BY_ID[l.ingId];
        const n = def?.name ?? l.ingId;
        if (!names.includes(n)) names.push(n);
        parts.push(`${n}×${def ? qtyText(l.qty, def.unit) : l.qty}（第${l.purchasedDay}天购入，第${l.expiredDay}天晨检发现过期）`);
      }
      const detail = parts.length > 8 ? `${parts.slice(0, 8).join("；")}；等共 ${parts.length} 个批次` : parts.join("；");
      return {
        data: { valueCents: v, items: names.join("、"), detail },
        options: [
          { id: "sell_cheap", label: "五折变四折：低价卖给大学生（按市价40%回收现金，口碑-5）" },
          { id: "better_mgmt", label: "加强库存管理（200元，卫生+5）" },
          { id: "ignore", label: "直接当垃圾扔掉" },
        ],
      };
    },
  },
  {
    id: "grandma_health", type: "家庭", title: "奶奶病情反复", probBp: 3000, cooldownDays: 14, blocking: true,
    desc: "社区诊所来电话：奶奶住院了，需要一笔钱。",
    condition: (s) => s.boss.background === "miserable",
    build: () => ({
      data: { surgery: 200000, conserve: 50000, help: 30000 },
      options: [
        { id: "surgery", label: "手术治疗（2000元）" },
        { id: "conserve", label: "保守治疗（500元）" },
        { id: "crowdfund", label: "申请社区众筹（+300元，口碑+10，每局限一次）" },
      ],
    }),
  },
  {
    id: "community_help", type: "公益", title: "社区帮扶", probBp: 1500, cooldownDays: 20, blocking: false, defaultOptionId: "polite_decline",
    once: true,
    desc: "街道办得知你的情况，提供一笔小额帮扶金和免费卫生培训。",
    condition: (s) => s.boss.background === "miserable",
    build: () => ({
      data: { amount: 100000 },
      options: [
        { id: "accept", label: "接受帮扶（+1000元，卫生+10）" },
        { id: "polite_decline", label: "婉拒（口碑+4，志气）" },
      ],
    }),
  },
  {
    id: "business_advice", type: "家庭", title: "家庭商业建议", probBp: 2000, cooldownDays: 25, blocking: false, defaultOptionId: "ignore",
    once: true,
    desc: "家里长辈提到某商圈铺位要降租，暗示你可以试试。",
    condition: (s) => s.boss.background === "affluent" || s.boss.background === "tycoon",
    build: () => ({
      data: {},
      options: [
        { id: "research", label: "实地考察（200元，口碑+3人脉）" },
        { id: "ignore", label: "专注眼前" },
      ],
    }),
  },
  {
    id: "lie_exposed", type: "舆情", title: "谎言被揭穿", probBp: 100, cooldownDays: 30, blocking: false, defaultOptionId: "admit",
    once: true,
    desc: "有网友翻出开业登记，你的「老字号」人设崩了。",
    condition: (s) => s.boss.credibilityRisk >= 50,
    build: () => ({
      data: {},
      options: [
        { id: "admit", label: "坦诚道歉（口碑-8）" },
        { id: "double_down", label: "嘴硬到底（口碑-25，客流-15%/7天）" },
      ],
    }),
  },
  {
    id: "holiday_promo", type: "节日", title: "节假日客流变化", probBp: 400, cooldownDays: 18, blocking: false, defaultOptionId: "coast",
    desc: "临近节假日，商圈人流结构要变了。",
    build: () => ({
      data: {},
      options: [
        { id: "festival_marketing", label: "节日营销（800元，3天客流+18%）" },
        { id: "coast", label: "佛系过节" },
      ],
    }),
  },
  // ========== 市井百态随机事件（可重复出现） ==========
  {
    id: "yuzhou_flood", type: "公益", title: "禹州水灾", probBp: 300, cooldownDays: 45, blocking: false, defaultOptionId: "watch",
    desc: "禹州大水，近日村民苦不堪言，各个企业纷纷伸出援手，捐献了大量物资！",
    build: () => ({
      data: {},
      options: [
        { id: "watch", label: "看看热闹（事不关己）" },
        { id: "donate", label: "捐助物资（-5000元，口碑+5）" },
      ],
    }),
  },
  {
    id: "staff_troubled", type: "员工", title: "员工的心事", probBp: 700, cooldownDays: 20, blocking: false, defaultOptionId: "ignore",
    desc: "在编员工看起来心事重重的样子，你要不要问问？",
    condition: (s, b) => b.staff.length > 0,
    build: (s, b) => {
      const e = [...b.staff].sort((a, c) => a.satisfaction - c.satisfaction)[0];
      return {
        data: { empId: e.id, name: e.name },
        options: [
          { id: "ignore", label: "当没看见（该员工压力+10）" },
          { id: "care", label: "真切关心，递瓶水问一句" },
        ],
      };
    },
  },
  {
    id: "staff_family_hardship", type: "员工", title: "家庭的变故", probBp: 0, cooldownDays: 30, blocking: true,
    desc: "前几日烦恼的员工突然找你聊天：前几天爸爸干农活摔断了腿，妈妈也老了照顾不了家，有点想离职回家照顾爸妈。",
    build: (s, b, pre) => {
      const empId = Number(pre?.empId ?? b.staff[0]?.id ?? 0);
      const e = b.staff.find((x) => x.id === empId);
      return {
        data: { empId, name: e?.name ?? "员工" },
        options: [
          { id: "comfort", label: `安慰对方：「家要紧，去吧」（该员工明日离职）` },
          { id: "money", label: "私下塞给他3000块（满意/忠诚各+50）" },
        ],
      };
    },
  },
  {
    id: "lottery", type: "奇遇", title: "捡到一张彩票", probBp: 250, cooldownDays: 40, blocking: false, defaultOptionId: "cash",
    desc: "看店的时候在门口捡到一张彩票，顺手一刮——居然中奖了！",
    build: (s) => {
      const amount = rndInt(s, 5000, 1000000);
      return {
        data: { amountCents: amount },
        options: [
          { id: "cash", label: `去兑奖（+${Math.floor(amount / 100)}元，见好就收）` },
          { id: "superstition", label: "横财晦气，原物交给片警" },
        ],
      };
    },
  },
  {
    id: "staff_early_leave", type: "员工", title: "员工想早退", probBp: 600, cooldownDays: 25, blocking: false, defaultOptionId: "allow",
    desc: "在编员工在下班后突然叫住你：「小孩生病了，这几天不舒服，能不能让我早点下班？」",
    condition: (s, b) => b.staff.length > 0,
    build: (s, b) => {
      const e = rndPick(s, b.staff);
      return {
        data: { empId: e.id, name: e.name },
        options: [
          { id: "allow", label: "「去吧，孩子要紧。」（满意/忠诚+20，口碑+1）" },
          { id: "deny", label: "「店里忙，不行。」（满意/忠诚-20）" },
        ],
      };
    },
  },
  {
    id: "harassment", type: "顾客", title: "邻桌的骚扰", probBp: 450, cooldownDays: 18, blocking: false, defaultOptionId: "police",
    desc: "店里今天有一群男人喝酒时故意刁难邻桌的女生，女生已经攥紧了手机。此时你会……",
    build: () => ({
      data: {},
      options: [
        { id: "police", label: "立刻报警（口碑+2）" },
        { id: "ignore", label: "多一事不如少一事（未来7天客流-20%）" },
        { id: "stand_up", label: "挺身而出（口碑+5~8，但可能受伤花1500元治疗）" },
      ],
    }),
  },
  {
    id: "experiment_result", type: "研发", title: "令人困惑的实验菜", probBp: 0, cooldownDays: 0, blocking: false, defaultOptionId: "toss",
    desc: "这锅东西散发着难以名状的气息——是倒掉，还是让它完成使命？",
    build: (_s, _b, pre) => ({
      data: { dishName: String(pre?.dishName ?? "无名料理") },
      options: [
        { id: "toss", label: "倒掉（破财消灾）" },
        { id: "serve", label: "送给不知情的顾客试吃（五五开）" },
      ],
    }),
  },
  // ========== 市井百态·新增随机事件（每店独立判定，允许重复触发） ==========
  {
    id: "pipe_burst", type: "设备", title: "后厨水管爆了", probBp: 380,
    probFor: (s, b) => b.store.equipmentHealth < 50 ? 950 : 380, // 设备健康低于50时概率提高
    cooldownDays: 12, blocking: false, defaultOptionId: "diy",
    desc: "后厨水管突然爆裂，地板上全是水，员工们一边拿拖把一边怀疑人生。",
    build: () => ({
      data: {},
      options: [
        { id: "pro", label: "立即找专业维修（1800元，明日客流-5%）" },
        { id: "diy", label: "员工自己抢修（500元，明日客流-10%；若维修能力不足再贴1000元）" },
        { id: "buckets", label: "继续营业，拿盆接水（口碑-2，未来3天客流-8%）" },
      ],
    }),
  },
  {
    id: "storm_day", type: "天气", title: "暴雨天，没人来了", probBp: 3200, cooldownDays: 7, blocking: false, defaultOptionId: "normal",
    desc: "窗外大雨倾盆，外卖平台订单也骤然减少。",
    condition: (s) => s.date.weather === "rain" || s.date.weather === "storm",
    build: () => ({
      data: {},
      options: [
        { id: "warm_set", label: "推出雨天热乎套餐（宣传费300元，口碑+2，未来2天客流+12%）" },
        { id: "normal", label: "正常营业（明日客流-25%）" },
        { id: "early_close", label: "提前打烊（额外损耗200元，明日客流-10%）" },
      ],
    }),
  },
  {
    id: "old_man_noodle", type: "温情", title: "老人每天都来吃同一道菜", probBp: 500, cooldownDays: 30, blocking: false, defaultOptionId: "plain",
    desc: "一位老人连续一周来店里吃同一碗面。他总坐在靠窗的位置，慢慢吃完，再安静地离开。",
    build: () => ({
      data: {},
      options: [
        { id: "side_dish", label: "记住他的口味，偶尔送一份小菜（80元，口碑+3，未来3天客流+3%）" },
        { id: "chat", label: "和他聊聊天（口碑+2，收获一段温馨顾客故事）" },
        { id: "plain", label: "正常接待" },
      ],
    }),
  },
  {
    id: "kid_painting", type: "温情", title: "小朋友画了一张画", probBp: 520, cooldownDays: 25, blocking: false, defaultOptionId: "tuck",
    desc: "一位小朋友在餐厅吃完饭，把一张画递给你。画上是餐厅、几张桌子，还有一个笑得很夸张的老板。",
    build: () => ({
      data: {},
      options: [
        { id: "hang", label: "把画挂在墙上（装裱20元，口碑+2，未来3天客流+2%）" },
        { id: "thank", label: "认真感谢小朋友（口碑+2）" },
        { id: "tuck", label: "把画收起来" },
      ],
    }),
  },
  {
    id: "staff_birthday", type: "温情", title: "员工偷偷给你过生日", probBp: 300, cooldownDays: 40, blocking: false, defaultOptionId: "cake",
    desc: "员工在打烊后拿出一个歪歪扭扭的蛋糕。没有人记得买蜡烛，于是他们插上了两根筷子。",
    condition: (s, b) => b.staff.length > 0,
    build: () => ({
      data: {},
      options: [
        { id: "supper", label: "请大家吃宵夜（300元，员工满意/忠诚各+10）" },
        { id: "cake", label: "一起分蛋糕（50元，员工关系改善）" },
      ],
    }),
  },
  {
    id: "thanks_letter", type: "温情", title: "一张没有署名的感谢信", probBp: 360, cooldownDays: 35, blocking: false, defaultOptionId: "check_hygiene",
    desc: "打烊时，桌上留下一张纸条：「今天是我最难熬的一天，谢谢你们让我吃到了一顿热饭。」",
    build: () => ({
      data: {},
      options: [
        { id: "keep", label: "把纸条收进纪念盒（口碑+2）" },
        { id: "display", label: "将纸条匿名展示在店里（物料10元，口碑+3，未来3天客流+2%）" },
        { id: "check_hygiene", label: "不公开，只把店里卫生再检查一遍（50元，口碑+1）" },
      ],
    }),
  },
  {
    id: "giant_cabbage", type: "脑洞", title: "一颗比脸还大的白菜", probBp: 420, cooldownDays: 30, blocking: false, defaultOptionId: "refund",
    desc: "供应商送来一颗巨大白菜，重量是普通白菜的五倍。他坚称这只是品种优良。",
    build: () => ({
      data: {},
      options: [
        { id: "limited_dish", label: "当天做成限量菜（售卖+500元，口碑+2，未来2天客流+8%）" },
        { id: "refund", label: "退货（运费损耗100元）" },
      ],
    }),
  },
  {
    id: "frog_takeover", type: "脑洞", title: "全店被青蛙玩偶占领", probBp: 350, cooldownDays: 30, blocking: false, defaultOptionId: "lost_found",
    desc: "一位顾客把青蛙玩偶落在店里，下班后，店里出现了10只青蛙。",
    build: () => ({
      data: {},
      options: [
        { id: "lost_found", label: "集中放到失物招领处（10元）" },
        { id: "corner", label: "给青蛙安排一个专属角落（100元，口碑+2，未来3天客流+5%）" },
        { id: "name_them", label: "给它们起名字并拍照（口碑+1，未来2天客流+3%）" },
      ],
    }),
  },
  {
    id: "epic_bad_review", type: "舆情", title: "顾客提交了三千字差评", probBp: 520, cooldownDays: 15, blocking: false, defaultOptionId: "core_only",
    desc: "顾客抱怨汤太热、椅子太冷、老板走路太快、隔壁桌的筷子不够有气势。",
    build: () => ({
      data: {},
      options: [
        { id: "reply_all", label: "认真逐条回复（打印费50元，口碑+1，未来2天客流不变）" },
        { id: "core_only", label: "只回复具体的食品问题（口碑+2）" },
        { id: "inside_joke", label: "把无关内容整理成内部笑话（口碑-1）" },
      ],
    }),
  },
  {
    id: "cat_manager", type: "脑洞", title: "一只猫宣布自己才是老板", probBp: 300, cooldownDays: 25, blocking: false, defaultOptionId: "photo",
    desc: "一只猫闯进餐厅，坐在收银台旁边。顾客们纷纷拍照，并开始称它为「店长」。",
    build: () => ({
      data: {},
      options: [
        { id: "find_owner", label: "联系主人并妥善安置（30元，口碑+1）" },
        { id: "photo", label: "在卫生和安全允许的前提下拍照留念（20元，口碑+2，未来2天客流+14%）" },
        { id: "mascot", label: "直接把它封为吉祥物（置办猫窝100元，口碑+2，未来3天客流+15%）" },
      ],
    }),
  },
  {
    id: "tax_flavor_review", type: "顾客", title: "顾客说你的菜吃出了税收的味道", probBp: 450, cooldownDays: 20, blocking: false, defaultOptionId: "record",
    desc: "顾客非常认真地评价：「这道菜很有层次，第一口是童年，第二口是房贷，第三口是税收。」",
    build: () => ({
      data: {},
      options: [
        { id: "ask_detail", label: "询问具体口味问题（口碑+1）" },
        { id: "record", label: "将评价匿名记录下来（口碑+2）" },
        { id: "joke_back", label: "回答「那您下次试试免税套餐」（口碑随机-1~+3）" },
      ],
    }),
  },
  {
    id: "art_plating", type: "顾客", title: "顾客要求把菜摆得像艺术展", probBp: 400, cooldownDays: 20, blocking: false, defaultOptionId: "explain",
    desc: "顾客表示自己不是来吃饭的，是来体验「可食用的空间叙事」。",
    build: () => ({
      data: {},
      options: [
        { id: "plate_it", label: "认真摆盘（手工费120元，口碑+2，未来2天客流+4%）" },
        { id: "explain", label: "解释餐厅主打实惠" },
        { id: "name_it", label: "给菜品取名《空盘前的沉思》（20元，口碑随机-2~+4）" },
      ],
    }),
  },
  {
    id: "rival_new_shop", type: "竞争", title: "隔壁开了一家同类型餐厅", probBp: 400, cooldownDays: 25, blocking: false, defaultOptionId: "stick",
    desc: "新店推出相似菜品，价格还比你便宜。",
    build: () => ({
      data: {},
      options: [
        { id: "optimize", label: "优化菜单和成本（咨询费300元，口碑+2，未来3天客流+5%）" },
        { id: "promo", label: "进行限时促销（500元，口碑+1，未来3天客流+10%）" },
        { id: "stick", label: "坚持自己的特色（口碑+1，客流不变）" },
      ],
    }),
  },
  // ========== 身世专属剧情事件 ==========
  {
    id: "pious_reporter", type: "剧情", title: "中国大孝子·记者来访", probBp: 1500, cooldownDays: 45, blocking: true,
    desc: "一位记者听说你白天颠勺、晚上照顾奶奶，举着话筒就挤了进来：「聊聊您的故事吧！」",
    condition: (s) => s.boss.background === "miserable" && s.day > 3,
    build: () => ({
      data: {},
      options: [
        { id: "honest", label: "如实相告自己的身世" },
        { id: "play_pious", label: "装老实人，含糊过去" },
        { id: "hide", label: "隐瞒一切，只谈菜品" },
      ],
    }),
  },
  {
    id: "genshin", type: "脑洞", title: "什么，原来你也玩原神？", probBp: 1200, cooldownDays: 60, blocking: false, defaultOptionId: "nope",
    desc: "一位背着虚空剑的客人落座，忽然死死盯着你围裙上的小挂件：「老板……你，也玩原神？」",
    condition: (s) => s.boss.background === "normal",
    build: () => ({
      data: {},
      options: [
        { id: "play", label: "「玩！提瓦特大陆启动！」" },
        { id: "nope", label: "「不玩，我是现充。」" },
      ],
    }),
  },
  {
    id: "marriage", type: "家庭", title: "妈打电话来催婚", probBp: 1500, cooldownDays: 40, blocking: true,
    desc: "父母托关系介绍了几位对象，电话话锋一转：「店里再忙，终身大事也得提上日程。」",
    condition: (s) => s.boss.background === "affluent" && (s.story.marriageStatus === "single" || s.story.marriageStatus === "divorced") && s.day > 7,
    build: () => ({
      data: {},
      options: [
        { id: "arrange", label: "去相亲（婚后每日家庭支出+500元，口碑每天+0.1）" },
        { id: "refuse", label: "不相亲，专心开店" },
        { id: "gay", label: "坦白：「妈，我是同性恋。」（口碑-1，后续偶有议论）" },
      ],
    }),
  },
  {
    id: "divorce", type: "家庭", title: "感情破裂：过不下去了", probBp: 1200, cooldownDays: 50, blocking: true,
    desc: "婚后矛盾终于爆发，对方把离婚协议拍在了你们第一次约会的那张桌子上。",
    condition: (s) => s.boss.background === "affluent" && s.story.marriageStatus === "married" && s.day > 30,
    build: () => ({
      data: {},
      options: [
        { id: "repair", label: "深夜后厨长谈，努力修复" },
        { id: "split", label: "同意离婚（现金分出一半）" },
      ],
    }),
  },
  {
    id: "fake_parents", type: "剧情", title: "当年把你丢掉是个错误……", probBp: 1000, cooldownDays: 70, blocking: true,
    desc: "一对自称「亲生父母」的男女堵在店门口声泪俱下，说当年抱错了孩子，如今千里来「认亲」。围观群众已经开始拍视频。",
    condition: (s) => s.boss.background === "tycoon",
    build: (s) => ({
      data: { demandCents: rndInt(s, STORY_EVENTS.fakeParents.demandMinCents, STORY_EVENTS.fakeParents.demandMaxCents) },
      options: [
        { id: "pay", label: "给钱息事宁人（金额自定）", payloadKey: "amount" },
        { id: "deny", label: "否认：「你们找错人了。」（口碑-2）" },
        { id: "test", label: "当场预约亲子鉴定" },
      ],
    }),
  },
];

export function findDef(id: string): EventDefFull | undefined {
  return EVENT_DEFS.find((d) => d.id === id);
}

function addLedger(s: GameState, b: Branch, account: import("../types").AccountId, cents: number, cash: boolean, memo: string): void {
  b.ledger.push({ day: s.day, account, amountCents: cents, cash, memo });
}

export function createPending(s: GameState, b: Branch, def: EventDefFull, pre?: Record<string, number | string>): PendingEvent {
  const { data, options } = def.build(s, b, pre);
  const pe: PendingEvent = {
    eventUid: s.events.nextUid++, defId: def.id, cityId: b.cityId, title: def.title, desc: def.desc,
    blocking: def.blocking, createdAtDay: s.day, data, options,
  };
  s.events.pending.push(pe);
  s.events.cooldowns[def.id] = s.day + def.cooldownDays;
  return pe;
}

// 每日事件骰：每个分店独立判定 → 每一个事件在每个分店都可能发生（概率可按分店状态动态调整）
export function tryDailyEvents(s: GameState): void {
  for (const b of Object.values(s.branches)) {
    if (!chance(s, EVENTS.dailyRollBp)) continue;
    const eligible = EVENT_DEFS.filter((d) =>
      d.probBp > 0 &&
      (s.events.cooldowns[d.id] ?? 0) <= s.day &&
      !(d.once && s.events.history.some((h) => h.defId === d.id)) &&
      !s.events.pending.some((p) => p.defId === d.id) &&
      (d.condition ? d.condition(s, b) : true),
    );
    if (eligible.length === 0) continue;
    const def = rndPick(s, eligible);
    const riskMods = getMods(s.boss.personality);
    const pb = def.probFor ? def.probFor(s, b) : def.probBp;
    if (chance(s, Math.round((pb * riskMods.eventRiskBp) / 10000))) {
      createPending(s, b, def);
    }
  }
}

// 父母来电（豪门）：全局折合现金 ≤ 1万触发，冷却限制重复来电
export function tryParentCall(s: GameState): void {
  if (s.boss.background !== "tycoon") return;
  const totalCny = totalCashCny(s);
  if (totalCny > TYCOON.triggerCashCents) return;
  if (s.day < s.events.parentCallCooldownUntil) return;
  if (s.events.pending.some((p) => p.defId === "parent_call")) return;
  const b = homeBranch(s);
  const amountCny = rndInt(s, TYCOON.transferMinCents, TYCOON.transferMaxCents);
  const amountLocal = toLocalCents(amountCny, CITY_BY_ID[b.cityId].fxPerCnyBp);
  const cond = chance(s, TYCOON.acceptConditionChanceBp);
  const pe: PendingEvent = {
    eventUid: s.events.nextUid++, defId: "parent_call", cityId: b.cityId, title: "父母来电",
    desc: cond
      ? `手机响了，是爸妈。他们说可以转 ${Math.floor(amountCny / 100)} 元应急，但要求你「别再折腾，回来接手家里生意」。`
      : `爸妈转来一笔钱应急：${Math.floor(amountCny / 100)} 元。「家里不缺这点钱，别硬撑。」`,
    blocking: false,
    createdAtDay: s.day,
    data: { amountCents: amountLocal, amountCnyCents: amountCny, hasCondition: cond ? 1 : 0 },
    options: [
      { id: "accept", label: `接受转账（+${Math.floor(amountCny / 100)}元${cond ? "，并承诺考虑回家" : ""}）` },
      { id: "refuse", label: "拒绝，我自己扛（口碑+4）" },
    ],
  };
  s.events.pending.push(pe);
  s.events.parentCallCooldownUntil = s.day + TYCOON.cooldownDays;
}

// 资金危机（分店现金为负时由结算生成，阻塞）
export function createWageCrisis(s: GameState, b: Branch): void {
  if (s.events.pending.some((p) => p.defId === "wage_crisis" && p.cityId === b.cityId)) return;
  const pe: PendingEvent = {
    eventUid: s.events.nextUid++, defId: "wage_crisis", cityId: b.cityId, title: "资金危机",
    desc: `${CITY_BY_ID[b.cityId].name}店现金已为负（${b.cashCents}分）。工资、房租、供应商都在看着你。`,
    blocking: true, createdAtDay: s.day, data: {},
    options: [
      { id: "hardship_loan", label: "借应急小额贷款（+3000元，月息0.6%）" },
      { id: "sell_equipment", label: "变卖部分设备（-30设备健康）" },
      { id: "family_help", label: "向家人/社区开口" },
      { id: "stubborn", label: "硬撑（员工满意度-15，口碑-8）" },
    ],
  };
  s.events.pending.push(pe);
}

// ---------------- 结算事件效果 ----------------
export function resolveEvent(s: GameState, uid: number, optionId: string, payload?: Record<string, string>): { message: string } {
  const idx = s.events.pending.findIndex((p) => p.eventUid === uid);
  if (idx < 0) return { message: "该事件已处理" };
  const pe = s.events.pending[idx];
  const b = s.branches[pe.cityId] ?? s.branches[s.activeCityId];
  const home = homeBranch(s);
  const d = pe.data;
  let message = "";
  // 新事件通用工具：本店当地货币收支 / 口碑(显示口径±1=内部10) / 持续客流效果
  const fx = CITY_BY_ID[b.cityId].fxPerCnyBp;
  const spend = (cnyCents: number, account: import("../types").AccountId, memo: string): number => {
    const c = toLocalCents(cnyCents, fx);
    b.cashCents -= c;
    addLedger(s, b, account, -c, true, memo);
    return c;
  };
  const earn = (cnyCents: number, account: import("../types").AccountId, memo: string): number => {
    const c = toLocalCents(cnyCents, fx);
    b.cashCents += c;
    addLedger(s, b, account, c, true, memo);
    return c;
  };
  const repBy = (displayDelta: number) => { b.reputation = clamp(b.reputation + displayDelta * 10, 0, 1000); };
  const effBoost = (label: string, trafficBp: number, days: number) => {
    b.boosts.push({ id: "ev_" + uid + "_" + label, label, trafficBp, untilDay: s.day + days, persistent: true });
  };
  const remove = () => {
    s.events.pending.splice(idx, 1);
    s.events.history.push({ defId: pe.defId, cityId: pe.cityId, day: s.day, optionId });
  };

  switch (pe.defId) {
    case "bug_complaint": {
      const price = (d.priceCents as number) ?? 3000;
      if (optionId === "pay_full") {
        const tenfold = d.tenfold === 1 && b.store.hygiene < 50;
        const refund = tenfold ? price * 10 : price * 2;
        addLedger(s, b, "refund", -refund, true, tenfold ? "投诉十倍赔偿" : "投诉赔偿");
        b.cashCents -= refund;
        b.reputation = clamp(b.reputation + (tenfold ? -6 : 4), 0, 1000);
        message = tenfold ? `顾客出示了市场监管电话，你赔了十倍菜钱（${refund}分）。` : `全款赔偿 ${refund} 分，围观顾客觉得你厚道，口碑+4。`;
      } else if (optionId === "deny") {
        if (b.store.hygiene >= 70) {
          b.reputation = clamp(b.reputation - 3, 0, 1000);
          message = "后厨监控和留样证明虫子是外带食品上的，你硬气了一回，但围观群众仍议论纷纷。口碑-3。";
        } else {
          const fine = chance(s, 3000) ? 200000 : 0;
          if (fine) { b.cashCents -= fine; addLedger(s, b, "event", -fine, true, "投诉升级：卫生举报罚款"); }
          b.reputation = clamp(b.reputation - 15, 0, 1000);
          b.boosts.push({ id: "rev_" + uid, label: "差评发酵", trafficBp: 9000, untilDay: s.day + 4, persistent: true });
          message = `否认失败，差评疯传${fine ? "，还被举报罚款2000元" : ""}。口碑-15。`;
        }
      } else if (optionId === "suspend") {
        if (b.menu[d.dishId as string]) b.menu[d.dishId as string].active = false;
        b.store.hygiene = clamp(b.store.hygiene + 8, 0, 100);
        b.reputation = clamp(b.reputation - 2, 0, 1000);
        message = "你当场停售该菜并大扫除。顾客觉得态度不错，但短期内上不了这道招牌。";
      }
      break;
    }
    case "blogger_dropin": {
      const followers = (d.followers as number) ?? 0;
      const matchBp = (d.matchBp as number) ?? 5000;
      const quality = (d.quality as number) ?? 50;
      const sigId = signatureDishId(s, b);
      const scale = Math.round(((0.5 + Math.min(1, followers / 20000)) / 1.5) * (0.7 + b.reputation / 1000) * (0.75 + matchBp / 15000) * 10000);
      const persistent = followers >= BLOGGER.persistentFollowerMin;
      const applyBoost = (multBp: number, days: number) => {
        if (!persistent) {
          message = "这条探店视频没有泛起水花（粉丝不足1000，不构成持续客流加成），但留下了一条评价。";
          b.reputation = clamp(b.reputation + Math.round((quality - 50) / 8), 0, 1000);
          return;
        }
        const add = Math.round(((BLOGGER.boostTrafficBp - 10000) * scale * multBp) / 10000 / 10000);
        b.boosts.push({ id: "bl_" + uid, label: `博主「${d.name}」探店`, trafficBp: 10000 + add, untilDay: s.day + days, persistent: true });
        message = `视频发布了，未来 ${days} 天客流 ${add >= 0 ? "+" : ""}${(add / 100).toFixed(1)}%。`;
      };
      const success = chance(s, Math.min(9000, Math.round((4000 + quality * 40 + matchBp / 10) * getMods(s.boss.personality).marketingBp / 10000)));
      if (optionId === "normal") {
        if (success) applyBoost(10000, BLOGGER.boostDays); else { message = "内容平淡，没掀起波澜，只有一条普通评价。"; b.reputation = clamp(b.reputation + 1, 0, 1000); }
      } else if (optionId === "extra") {
        const cogs = consumePartial(b, sigId, 5000);
        addLedger(s, b, "cogs", -cogs, false, "博主加量接待食材");
        message = "你给博主加了半份料。";
        if (success || chance(s, 2500)) applyBoost(11500, BLOGGER.boostDays);
        else message += " 但博主只夸了一句「实在」。";
      } else if (optionId === "gift") {
        const res = cookDish(b, sigId);
        if (res.ok) addLedger(s, b, "cogs", -res.cogsCents, false, "赠送招牌菜");
        b.reputation = clamp(b.reputation + Math.round(6 * scale / 10000) + 2, 0, 1000);
        applyBoost(12000, BLOGGER.boostDays + 2);
      } else if (optionId === "meal") {
        const cost = Math.round(marketCogsOfDish(b, sigId) * 1.6);
        addLedger(s, b, "cogs", -cost, false, "博主套餐补贴");
        applyBoost(success ? 13000 : 10500, BLOGGER.boostDays);
      } else {
        b.reputation = clamp(b.reputation - 5, 0, 1000);
        if (chance(s, 4000)) b.boosts.push({ id: "neg_" + uid, label: "博主吐槽你拒客", trafficBp: 9200, untilDay: s.day + 3, persistent: true });
        message = "博主在评论区挂了你的拒客态度。";
      }
      s.bloggerLog.push({ day: s.day, cityId: b.cityId, kind: "探店", name: String(d.name), followers, audienceMatchBp: matchBp, contentQuality: quality, response: optionId, outcome: message });
      break;
    }
    case "interview_visitor": {
      const qIds = [String(d.q0), String(d.q1), String(d.q2)];
      const ans = (payload?.answers ?? "").split(",");
      const score = computeInterviewScore(qIds, ans, s.day);
      if (ans.includes("q_years_lie")) s.boss.credibilityRisk = clamp(s.boss.credibilityRisk + INTERVIEW.lieYearsCredibilityRisk, 0, 100);
      const followers = (d.followers as number) ?? 5000;
      const matchBp = (d.matchBp as number) ?? 5000;
      const scale = Math.round(((0.5 + Math.min(1, followers / 30000)) / 1.5) * (0.7 + b.reputation / 1000) * (0.75 + matchBp / 15000) * 10000);
      if (score >= INTERVIEW.goodThreshold) {
        const add = Math.round(((INTERVIEW.goodBoostBp - 10000) * scale) / 10000);
        b.boosts.push({ id: "iv_" + uid, label: "采访出圈", trafficBp: 10000 + add, untilDay: s.day + INTERVIEW.goodDays, persistent: true });
        message = `采访播出后反响不错，${INTERVIEW.goodDays} 天内客流约 +${(add / 100).toFixed(1)}%。`;
      } else if (score < INTERVIEW.badThreshold) {
        const cut = Math.min(3000, Math.round(((10000 - INTERVIEW.badPenaltyBp) * scale * 12) / 10000 / 10));
        b.boosts.push({ id: "iv_" + uid, label: "采访翻车", trafficBp: 10000 - cut, untilDay: s.day + INTERVIEW.badDays, persistent: true });
        message = `回答翻车，弹幕一片嘲讽，${INTERVIEW.badDays} 天内客流下滑。`;
      } else {
        message = "节目正常播出，没什么水花，就当免费曝光一次。";
      }
      s.bloggerLog.push({ day: s.day, cityId: b.cityId, kind: "采访", name: String(d.name), followers, audienceMatchBp: matchBp, contentQuality: score, response: ans.join("/"), outcome: message });
      break;
    }
    case "price_spike": {
      const ingId = String(d.ingId);
      const shock = d.short === 1 ? null : (d.shockBp as number);
      if (optionId === "deposit") {
        b.cashCents -= d.depositCents as number;
        addLedger(s, b, "event", -(d.depositCents as number), true, "保供定金");
        marketShock(b, ingId, shock === null ? 10800 : Math.round(10000 + ((shock as number) - 10000) * 0.2), d.days as number, "保供");
        message = `付了定金，${ING_BY_ID[ingId].name}对你保供，涨幅被压到20%以内。`;
      } else if (optionId === "buy_now") {
        const buyCost = Math.round(b.market[ingId].priceCents * 1.2);
        const def = ING_BY_ID[ingId];
        b.cashCents -= buyCost;
        addLedger(s, b, "purchase", -buyCost, true, "溢价10%散户调货");
        addLotFromBuyLocal(s, b, ingId, def ? def.perPurchase : 1000);
        marketShock(b, ingId, shock, d.days as number, d.short === 1 ? "缺货" : "涨价");
        message = "你从散户手里溢价调了一批货，行情波动照常影响市场。";
      } else {
        marketShock(b, ingId, shock, d.days as number, d.short === 1 ? "缺货" : "涨价");
        message = d.short === 1 ? `${ING_BY_ID[ingId].name}缺货了，当地市场挂零，几天后再看。` : `行情涨了，${ING_BY_ID[ingId].name}贵了不少，先等回落。`;
      }
      break;
    }
    case "equip_failure": {
      if (optionId === "repair") {
        const cost = rndInt(s, d.repairMin as number, d.repairMax as number);
        b.cashCents -= cost;
        addLedger(s, b, "repair", -cost, true, "设备维修");
        b.store.equipmentHealth = clamp(b.store.equipmentHealth + 15, 0, 100);
        message = `维修花了 ${Math.floor(cost / 100)} 元，设备勉强撑住。`;
      } else if (optionId === "degraded") {
        b.store.equipmentHealth = clamp(b.store.equipmentHealth - 25, 0, 100);
        message = "设备带病运转，出餐稳定性和品质都受了影响。";
      } else {
        b.cashCents -= d.replaceCents as number;
        addLedger(s, b, "repair", -(d.replaceCents as number), true, "设备换新");
        b.store.equipmentHealth = 100;
        message = "直接换新，后厨效率回来了。";
      }
      break;
    }
    case "staff_resign": {
      const empId = d.empId as number;
      const e = b.staff.find((x) => x.id === empId);
      if (!e) { message = "那位员工已经不在店里了。"; break; }
      if (optionId === "raise") {
        e.baseWageCents = Math.round(e.baseWageCents * 1.3);
        e.satisfaction = clamp(e.satisfaction + 20, 0, 100);
        e.loyalty = clamp(e.loyalty + 15, 0, 100);
        message = `${e.name} 留下来了，但你的日薪表多了一笔永久支出。`;
      } else if (optionId === "talk") {
        if (chance(s, 2000 + e.loyalty * 60)) {
          e.baseWageCents = Math.round(e.baseWageCents * 1.1);
          e.satisfaction = clamp(e.satisfaction + 12, 0, 100);
          message = `聊完才知道是误会，${e.name} 红着眼回来了。`;
        } else {
          b.staff = b.staff.filter((x) => x.id !== empId);
          b.reputation = clamp(b.reputation - 2, 0, 1000);
          message = `${e.name} 还是走了。`;
        }
      } else {
        b.staff = b.staff.filter((x) => x.id !== empId);
        message = `${e.name} 办完了交接，祝你顺利。`;
      }
      break;
    }
    case "competitor_open": {
      if (optionId === "price_war") {
        b.cashCents -= 20000;
        addLedger(s, b, "marketing", -20000, true, "对抗促销");
        b.boosts.push({ id: "cp_" + uid, label: "对手压力(价格战)", trafficBp: 9500, untilDay: s.day + 14, persistent: true });
        message = "你跟价打折保住了客流，但毛利被削。";
      } else if (optionId === "quality") {
        b.cashCents -= 50000;
        addLedger(s, b, "other", -50000, true, "品质投入");
        b.store.hygiene = clamp(b.store.hygiene + 10, 0, 100);
        b.boosts.push({ id: "cp_" + uid, label: "对手分流", trafficBp: 9800, untilDay: s.day + 14, persistent: true });
        message = "你选择卷品质，新客观望，老客认可。";
      } else {
        b.boosts.push({ id: "cp_" + uid, label: "新店分流", trafficBp: 8800, untilDay: s.day + 14, persistent: true });
        message = "对手开业促销半个月，你眼睁睁看着门口分走人流。";
      }
      break;
    }
    case "long_queue": {
      if (optionId === "open_all") {
        b.store.openSlots = [...ALL_SLOTS];
        message = "全天档口拉满，排班记得重新确认。";
        b.planConfirmedDirty = true;
      } else if (optionId === "free_tea") {
        b.cashCents -= 20000;
        addLedger(s, b, "event", -20000, true, "排队安抚饮品");
        b.reputation = clamp(b.reputation + 5, 0, 1000);
        message = "一杯酸梅汤稳住了队伍。";
      } else {
        b.reputation = clamp(b.reputation - 8, 0, 1000);
        message = "保安式限流劝退了一批人，网上有人说你「店大欺客」。";
      }
      break;
    }
    case "bad_review_spread": {
      if (optionId === "apologize") {
        b.cashCents -= 30000;
        addLedger(s, b, "other", -30000, true, "整改投入");
        b.store.hygiene = clamp(b.store.hygiene + 10, 0, 100);
        b.reputation = clamp(b.reputation + 15, 0, 1000);
        message = "道歉信+明厨亮灶直播，风评反转。";
      } else if (optionId === "pr") {
        b.cashCents -= 80000;
        addLedger(s, b, "marketing", -80000, true, "公关投放");
        b.reputation = clamp(b.reputation + 8, 0, 1000);
        message = "公关稿压下了节奏。";
      } else {
        if (chance(s, 5000)) {
          b.reputation = clamp(b.reputation + 2, 0, 1000);
          message = "你的回怼意外成为梗，黑红了一把。";
        } else {
          b.reputation = clamp(b.reputation - 12, 0, 1000);
          b.boosts.push({ id: "br_" + uid, label: "网友逆反", trafficBp: 8800, untilDay: s.day + 5, persistent: true });
          message = "你赢了嘴仗，输了评分。";
        }
      }
      break;
    }
    case "supplier_default": {
      const pd = b.pendingDeliveries[0];
      if (optionId === "claim") {
        const got = chance(s, 6000);
        b.pendingDeliveries = b.pendingDeliveries.slice(1);
        if (got) {
          b.cashCents += 10000;
          addLedger(s, b, "event", 10000, true, "违约索赔");
          message = "合同站你这边，拿到100元违约补偿，货没了。";
        } else {
          message = "供应商扯皮成功，货和说法都没有。";
        }
      } else if (optionId === "switch") {
        b.pendingDeliveries = b.pendingDeliveries.slice(1);
        message = "只能认栽，货没了，重新找渠道。";
      } else {
        b.pendingDeliveries = b.pendingDeliveries.slice(1);
        message = "你连夜自己开车去当地市场补了货（加价约两成，见采购账）。";
        if (pd) {
          const def = ING_BY_ID[pd.ingId];
          const cost = Math.max(0, Math.round((pd.qty * 1.2 * pd.unitPriceCents) / (def?.perPurchase ?? 1000)));
          b.cashCents -= cost;
          addLedger(s, b, "purchase", -cost, true, "自提加价补货");
          if (def) b.inventory[pd.ingId] = (b.inventory[pd.ingId] ?? []).concat([{ id: b.nextLotId++, ingId: pd.ingId, qty: pd.qty, unitPriceCents: Math.round(pd.unitPriceCents * 1.2), perPurchase: pd.perPurchase, expiresDay: pd.expiresDay, storage: pd.storage, purchasedDay: s.day }]);
        }
      }
      break;
    }
    case "vip_request": {
      if (optionId === "accept") {
        b.cashCents -= 50000;
        addLedger(s, b, "event", -50000, true, "熟客定制家宴补贴");
        b.regulars += 5;
        b.reputation = clamp(b.reputation + 6, 0, 1000);
        message = "家宴很成功，这家人以后每周都来。";
      } else {
        b.reputation = clamp(b.reputation - 2, 0, 1000);
        message = "婉拒了，老客有点失落。";
      }
      break;
    }
    case "expiry_alarm": {
      const book = b.pendingSpoilage.reduce((a, l) => a + Math.round((l.qty * l.unitPriceCents) / l.perPurchase), 0);
      if (optionId === "sell_cheap") {
        let recovered = 0;
        for (const l of b.pendingSpoilage) {
          const mkt = b.market[l.ingId]?.priceCents ?? l.unitPriceCents;
          recovered += Math.round(Math.round((l.qty * mkt) / l.perPurchase) * STORY_EVENTS.spoilSale.priceBp / 10000);
        }
        b.cashCents += recovered;
        if (book > 0) addLedger(s, b, "spoil", -book, false, "过期食材处置（账面成本）");
        if (recovered > 0) addLedger(s, b, "event", recovered, true, "过期食材折价卖给大学生");
        b.reputation = clamp(b.reputation + STORY_EVENTS.spoilSale.repCost, 0, 1000);
        message = `以市价四成回收了 ${recovered} 分现金。学生们一边吃一边怀疑人生，但还是掏了钱。口碑-5。`;
        b.pendingSpoilage = [];
      } else if (optionId === "better_mgmt") {
        if (book > 0) { addLedger(s, b, "spoil", -book, false, "过期食材报废"); b.pendingSpoilage = []; }
        b.cashCents -= 20000;
        addLedger(s, b, "other", -20000, true, "库存管理培训");
        b.store.hygiene = clamp(b.store.hygiene + 5, 0, 100);
        message = book > 0 ? `报废了账面 ${book} 分的过期食材，贴了效期标签，先进先出。` : "贴了效期标签，先进先出，损耗会降下来。";
      } else {
        if (book > 0) { addLedger(s, b, "spoil", -book, false, "过期食材报废"); b.pendingSpoilage = []; }
        if (b.store.hygiene < 60) b.reputation = clamp(b.reputation - 3, 0, 1000);
        message = "你把过期食材密封扔掉，眼不见为净。希望这页别翻到顾客碗里。";
      }
      break;
    }
    case "pious_reporter": {
      const P = STORY_EVENTS.pious;
      if (optionId === "honest") {
        b.reputation = clamp(b.reputation + P.honestRepCents, 0, 1000);
        b.boosts.push({ id: "story_pious_" + uid, label: "「中国大孝子」报道", trafficBp: P.honestBoostBp, untilDay: s.day + P.honestDays, persistent: true });
        s.story.piousGoodUntilDay = s.day + P.honestDays;
        message = `报道播出，无数人记住了你和奶奶。口碑+5，未来 ${P.honestDays} 天客流提升，顾客排再久也没人抱怨。`;
      } else if (optionId === "play_pious") {
        if (chance(s, P.playPiousBp)) {
          b.reputation = clamp(b.reputation + P.playPiousRep, 0, 1000);
          b.boosts.push({ id: "story_pious_" + uid, label: "老实人电台版", trafficBp: P.playPiousBoostBp, untilDay: s.day + P.playPiousDays, persistent: true });
          message = "你含糊地讲了个大概，观众觉得实在。口碑+3，客流小幅上升。";
        } else {
          message = "你支支吾吾，节目剪辑后毫无波澜——什么都没发生。";
        }
      } else {
        if (chance(s, P.hideSuccessBp)) {
          b.reputation = clamp(b.reputation + P.hideGoodRep, 0, 1000);
          b.boosts.push({ id: "story_pious_" + uid, label: "「只谈菜」的清冷人设", trafficBp: P.hideGoodBoostBp, untilDay: s.day + P.hideGoodDays, persistent: true });
          s.story.piousGoodUntilDay = s.day + P.hideGoodDays;
          message = `你一字不提家事，只聊菜品，沉默反而成了话题。口碑+20，未来 ${P.hideGoodDays} 天客流大涨，还收获一批「泥泞中开出鲜花」的五星长评。`;
        } else {
          b.reputation = clamp(b.reputation + P.hideBadRep, 0, 1000);
          s.story.piousFakeUntilDay = s.day + P.hideBadDays;
          message = "有网友扒出你住院的奶奶，质疑你「立人设」。口碑-2，未来几天偶尔冒出一星「死装」。";
        }
      }
      break;
    }
    case "genshin": {
      const G = STORY_EVENTS.genshin;
      if (optionId === "play") {
        const local = toLocalCents(G.playCashCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
        b.cashCents += local;
        addLedger(s, b, "transferIn", local, true, "「原神之神」豪客打赏");
        b.reputation = clamp(b.reputation + G.playRep, 0, 1000);
        message = "暗号对上了！对方包下卡座并豪掷5000元：「兄弟，提瓦特见。」你赢了，但说不清哪里不对。口碑-5。";
      } else {
        b.reputation = clamp(b.reputation + G.nopeRep, 0, 1000);
        message = "你正气凛然地否认。对方沉默三秒，结账时多给了小费，并发了条「老板是现充」的探店笔记。口碑+5。";
      }
      break;
    }
    case "marriage": {
      const M = STORY_EVENTS.marriage;
      if (optionId === "arrange") {
        s.story.marriageStatus = "married";
        message = "你开始了规律相亲并顺利定下婚事，家里放心了，钱包担心了。（婚后每日家庭支出+500元，口碑每天+0.1）";
      } else if (optionId === "refuse") {
        message = "「先搞事业。」你挂了电话，耳根清净，一切照旧。";
      } else {
        b.reputation = clamp(b.reputation + M.gayRep, 0, 1000);
        s.story.gayUntilDay = s.day + M.gayReviewDays;
        message = "电话那头沉默了整整一分钟。之后一段时间，评论区偶尔吵成两派：一派喊「死gay」，一派说「爱只是爱」。口碑-1。";
      }
      break;
    }
    case "divorce": {
      const D = STORY_EVENTS.divorce;
      if (optionId === "repair") {
        b.reputation = clamp(b.reputation + D.repairRep, 0, 1000);
        message = "你们在打烊后的后厨聊到天亮，决定再试一次。口碑+0.5。";
      } else {
        const loss = Math.max(0, Math.round((home.cashCents * D.splitBp) / 10000));
        home.cashCents -= loss;
        if (loss > 0) addLedger(s, home, "other", -loss, true, "离婚财产分割");
        s.story.marriageStatus = "divorced";
        message = `协议生效：现金按五五开分出了 ${Math.floor(loss / 100)} 元。账本轻松了，心里空了一块。`;
      }
      break;
    }
    case "fake_parents": {
      const F = STORY_EVENTS.fakeParents;
      const demand = (d.demandCents as number) ?? 1000000;
      if (optionId === "pay") {
        const give = clamp(Math.round(Number(payload?.amountCents ?? 0)) || 0, 0, b.cashCents);
        const acceptBp = give >= demand ? 10000 : clamp(Math.round((give * 10000) / Math.max(1, demand)), 0, F.acceptCapBp);
        if (give <= 0) {
          b.reputation = clamp(b.reputation + F.rejectRep, 0, 1000);
          message = "你一分钱没给。两人原地开哭，围观群众的手机怼到你脸上。口碑-3。";
        } else if (chance(s, acceptBp)) {
          b.cashCents -= give;
          addLedger(s, b, "event", -give, true, "「认亲费」（封口）");
          message = `你给了 ${Math.floor(give / 100)} 元。两人飞快收下，道了谢，转身去了隔壁火锅店——变脸之快，令人咋舌。`;
        } else {
          b.reputation = clamp(b.reputation + F.rejectRep, 0, 1000);
          message = `「${Math.floor(give / 100)}元？打发叫花子呢！」两人嫌给得少，在门口又闹了一场才悻悻离开。口碑-3。钱没给出去。`;
        }
      } else if (optionId === "deny") {
        b.reputation = clamp(b.reputation + F.denyRep, 0, 1000);
        message = "你冷冷丢下一句「保安，报警」。两人骂骂咧咧走了，但围观群众已经替你脑补了八十集连续剧。口碑-2。";
      } else {
        b.reputation = clamp(b.reputation + F.testRep, 0, 1000);
        message = "亲子鉴定结果：毫无血缘关系。两人脸色精彩，落荒而逃。你请围观街坊每人喝了瓶汽水。口碑+5。";
      }
      break;
    }
    case "yuzhou_flood": {
      if (optionId === "donate") {
        const costCny = 500000;
        const cost = toLocalCents(costCny, CITY_BY_ID[b.cityId].fxPerCnyBp);
        if (b.cashCents >= cost) {
          b.cashCents -= cost;
          addLedger(s, b, "event", -cost, true, "禹州水灾捐助");
          b.reputation = clamp(b.reputation + 50, 0, 1000);
          message = "一车泡面、矿泉水和药品连夜发往禹州。新闻里出现了你的店名。口碑+5。";
        } else {
          message = "你想捐，但这家店的账撑不起这份心意。默默多煮了几碗面，发给逃难来城里的人。";
        }
      } else {
        message = "你刷着手机看到救援新闻，叹了口气，继续切配。";
      }
      break;
    }
    case "staff_troubled": {
      const e = b.staff.find((x) => x.id === Number(d.empId));
      if (!e) { message = "那位员工看起来已经想开了。"; break; }
      if (optionId === "ignore") {
        e.stress = clamp(e.stress + 10, 0, 100);
        message = `${e.name} 欲言又止，最后什么也没说。压力+10。`;
      } else {
        e.satisfaction = clamp(e.satisfaction + 8, 0, 100);
        e.loyalty = clamp(e.loyalty + 8, 0, 100);
        e.stress = clamp(e.stress - 10, 0, 100);
        s.scheduled.push({ triggerDay: s.day + 3, cityId: b.cityId, defId: "staff_family_hardship", data: { empId: e.id } });
        message = `${e.name} 摇摇头，笑着说「没什么，就是有点累」。——但你注意到，那晚 ta 收拾得很晚才走。`;
      }
      break;
    }
    case "staff_family_hardship": {
      const e = b.staff.find((x) => x.id === Number(d.empId));
      if (!e) { message = "那位员工已经不在了。"; break; }
      if (optionId === "comfort") {
        e.pendingLeaveDay = s.day + 1;
        message = `你拍了拍${e.name}的肩膀：「家要紧，路上顺利。」对方深深鞠了一躬。明天 ta 就走了。`;
      } else {
        const cost = toLocalCents(300000, CITY_BY_ID[b.cityId].fxPerCnyBp);
        if (b.cashCents < cost) {
          message = `你摸遍口袋凑不出3000块。${e.name}看你为难的样子反而笑了：「老板，没事的。」（未支出）`;
        } else {
          b.cashCents -= cost;
          addLedger(s, b, "event", -cost, true, `员工${e.name}家庭救助`);
          e.satisfaction = clamp(e.satisfaction + 50, 0, 100);
          e.loyalty = clamp(e.loyalty + 50, 0, 100);
          e.stress = clamp(e.stress - 30, 0, 100);
          message = `${e.name}攥着信封，眼泪砸在账本上：「老板，我哪儿也不去了。」满意/忠诚+50。`;
        }
      }
      break;
    }
    case "lottery": {
      const amount = Number(d.amountCents ?? 0);
      if (optionId === "cash") {
        b.cashCents += amount;
        addLedger(s, b, "transferIn", amount, true, "捡到彩票兑奖");
        message = `你攥着 ${Math.floor(amount / 100)} 元奖金，郑重地在店门口挂了「今日店里有喜」。`;
      } else {
        b.reputation = clamp(b.reputation + 10, 0, 1000);
        message = "你把彩票原件交给了片警。三天后派出所来电：中奖者领回了彩票，还给你送来一面「拾金不昧」的小旗子。";
      }
      break;
    }
    case "staff_early_leave": {
      const e = b.staff.find((x) => x.id === Number(d.empId));
      if (!e) { message = "那位员工今天没来上班。"; break; }
      if (optionId === "allow") {
        e.satisfaction = clamp(e.satisfaction + 20, 0, 100);
        e.loyalty = clamp(e.loyalty + 20, 0, 100);
        b.reputation = clamp(b.reputation + 10, 0, 1000);
        message = `${e.name} 连声道谢，第二天带着孩子的好消息回来上班了。店里的人都说，老板这人能处。口碑+1。`;
      } else {
        e.satisfaction = clamp(e.satisfaction - 20, 0, 100);
        e.loyalty = clamp(e.loyalty - 20, 0, 100);
        message = `${e.name} 点点头没说话，但那晚炒锅的火，大得有点危险。满意/忠诚-20。`;
      }
      break;
    }
    case "harassment": {
      if (optionId === "police") {
        b.reputation = clamp(b.reputation + 20, 0, 1000);
        message = "你不动声色地报了警，警察十分钟后到场。女生临走时给你的账号写了一条五星长评。口碑+2。";
      } else if (optionId === "ignore") {
        b.boosts.push({ id: "hs_" + uid, label: "骚扰事件传开了", trafficBp: 8000, untilDay: s.day + 7, persistent: true });
        message = "你低头擦桌子。当晚，那条视频挂到了网上，评论区都在说「那家店没人管」。未来7天客流-20%。";
      } else {
        if (chance(s, 5000)) {
          b.reputation = clamp(b.reputation + 50, 0, 1000);
          message = "你抄起酒瓶往桌上一砸，那群人骂骂咧咧地走了。全场寂静，然后爆发出掌声。口碑+5。";
        } else {
          b.reputation = clamp(b.reputation + 80, 0, 1000);
          const med = toLocalCents(150000, CITY_BY_ID[b.cityId].fxPerCnyBp);
          b.cashCents -= med;
          addLedger(s, b, "repair", -med, true, "挺身而出受伤治疗");
          message = "你把女生护到后厨，挨了两瓶，缝了针。当晚「硬气老板」上了同城热搜。口碑+8，医药费1500元。";
        }
      }
      break;
    }
    case "experiment_result": {
      const dishName = String(d.dishName ?? "无名料理");
      if (optionId === "toss") {
        message = "你把它倒进了下水道。下水道沉默了三秒，然后缓缓地流下了眼泪。";
      } else {
        if (chance(s, STORY_EVENTS ? 5000 : 5000)) {
          b.reputation = clamp(b.reputation + 5, 0, 1000);
          b.reviews.unshift({ day: s.day, segName: "勇敢的顾客", dishName, score: 5, text: "Unexpected惊喜！这道融合菜有种混乱的美感，居然很好吃。" });
          message = "一位猎奇的顾客试吃后两眼放光：「这是解构主义菜？！」好评+1，口碑+0.5。";
        } else {
          b.reputation = clamp(b.reputation - 5, 0, 1000);
          b.reviews.unshift({ day: s.day, segName: "可怜的顾客", dishName, score: 1, text: "店家给我吃了一种无法形容的东西，建议报警。" });
          message = "那位顾客放下筷子，叫来了你，表情平静地吐了三分钟。差评+1，口碑-0.5。";
        }
      }
      break;
    }
    case "grandma_health": {
      if (optionId === "surgery") {
        const cost = toLocalCents(d.surgery as number, CITY_BY_ID[home.cityId].fxPerCnyBp);
        home.cashCents -= cost;
        addLedger(s, home, "family", -cost, true, "奶奶手术费");
        home.reputation = clamp(home.reputation + 2, 0, 1000);
        message = "手术很成功。奶奶醒来第一句话：店还好吗？";
      } else if (optionId === "conserve") {
        const cost = toLocalCents(d.conserve as number, CITY_BY_ID[home.cityId].fxPerCnyBp);
        home.cashCents -= cost;
        addLedger(s, home, "family", -cost, true, "奶奶保守治疗");
        message = "医生摇头，但你能做的只有这些。";
      } else {
        if (!s.events.familyHelpUsed) {
          s.events.familyHelpUsed = true;
          const got = toLocalCents(d.help as number, CITY_BY_ID[home.cityId].fxPerCnyBp);
          home.cashCents += got;
          addLedger(s, home, "transferIn", got, true, "社区众筹");
          home.reputation = clamp(home.reputation + 10, 0, 1000);
          message = "街坊们自发筹了一笔钱，你在诊所走廊哭得像个孩子。";
        } else {
          message = "上次已经麻烦过大家了，这次你张不开口。";
        }
      }
      break;
    }
    case "community_help": {
      if (optionId === "accept") {
        const got = toLocalCents(d.amount as number, CITY_BY_ID[home.cityId].fxPerCnyBp);
        home.cashCents += got;
        addLedger(s, home, "transferIn", got, true, "街道帮扶金");
        home.store.hygiene = clamp(home.store.hygiene + 10, 0, 100);
        message = "街道帮扶到账1000元，附赠免费卫生培训。";
      } else {
        home.reputation = clamp(home.reputation + 4, 0, 1000);
        message = "你笑着婉拒了。志气也是一种资产。";
      }
      break;
    }
    case "business_advice": {
      if (optionId === "research") {
        home.cashCents -= 20000;
        addLedger(s, home, "other", -20000, true, "考察交通");
        home.reputation = clamp(home.reputation + 3, 0, 1000);
        message = "确实有便宜铺位，人脉记下了。";
      } else {
        message = "你先顾好眼前这一家。";
      }
      break;
    }
    case "lie_exposed": {
      if (optionId === "admit") {
        b.reputation = clamp(b.reputation - 8, 0, 1000);
        message = "道歉视频效果一般，但风波小一些。";
      } else {
        b.reputation = clamp(b.reputation - 25, 0, 1000);
        b.boosts.push({ id: "lx_" + uid, label: "人设崩塌", trafficBp: 8500, untilDay: s.day + 7, persistent: true });
        message = "你嘴硬到底，被锤上了同城热搜。";
      }
      break;
    }
    case "holiday_promo": {
      if (optionId === "festival_marketing") {
        b.cashCents -= 80000;
        addLedger(s, b, "marketing", -80000, true, "节日营销");
        const mods = getMods(s.boss.personality);
        const add = Math.round(((1800) * mods.marketingBp) / 10000);
        b.boosts.push({ id: "hp_" + uid, label: "节日氛围", trafficBp: 10000 + add, untilDay: s.day + 3, persistent: true });
        message = "节日装饰+套餐海报，3天客流提升（受性格营销系数影响）。";
      } else {
        message = "随它去吧，节假日本来就是缘分。";
      }
      break;
    }
    case "parent_call": {
      const amount = (d.amountCents as number) ?? 0;
      if (optionId === "accept") {
        b.cashCents += amount;
        addLedger(s, b, "transferIn", amount, true, "父母转账");
        s.events.transferredTotalCents += (d.amountCnyCents as number) ?? amount;
        s.events.transferCount++;
        message = `父母转账到账（折合 ${Math.floor(((d.amountCnyCents as number) ?? amount) / 100)} 元）${d.hasCondition === 1 ? "。他们要你「考虑回家接手生意」，这话你记在账本扉页。" : "。"}`;
      } else {
        b.reputation = clamp(b.reputation + 4, 0, 1000);
        message = "你挂了电话，继续切配。口碑+4。";
      }
      break;
    }
    case "wage_crisis": {
      if (optionId === "hardship_loan") {
        const amount = toLocalCents(300000, CITY_BY_ID[b.cityId].fxPerCnyBp);
        b.cashCents += amount;
        b.loans.push({ id: b.loans.length + 1, principalCents: amount, owedCents: Math.round(amount * 1.06), rateBp: 60, monthlyDueDay: s.day + 30 });
        addLedger(s, b, "transferIn", amount, true, "应急小额贷款到账");
        message = "借到折合3000元的应急贷款，下月起按月还本付息。";
      } else if (optionId === "sell_equipment") {
        const got = Math.round(b.store.equipmentHealth * 800);
        b.cashCents += got;
        b.store.equipmentHealth = clamp(b.store.equipmentHealth - 30, 0, 100);
        addLedger(s, b, "transferIn", got, true, "变卖设备");
        message = `变卖了两台设备，回笼 ${Math.floor(got / 100)} 元。`;
      } else if (optionId === "family_help") {
        if (s.boss.background === "miserable" && !s.events.familyHelpUsed) {
          s.events.familyHelpUsed = true;
          const got = toLocalCents(50000, CITY_BY_ID[b.cityId].fxPerCnyBp);
          b.cashCents += got;
          addLedger(s, b, "transferIn", got, true, "社区临时救助");
          message = "社区知道你的难处，临时救助500元。";
        } else if (s.boss.background === "affluent" || s.boss.background === "tycoon") {
          const got = toLocalCents(200000, CITY_BY_ID[b.cityId].fxPerCnyBp);
          b.cashCents += got;
          addLedger(s, b, "transferIn", got, true, "家庭临时支援");
          message = "家里转来折合2000元：「撑不住就说。」";
        } else {
          b.reputation = clamp(b.reputation - 5, 0, 1000);
          message = "普通人家的通讯录里没有能借钱的人。";
        }
      } else {
        for (const e of b.staff) e.satisfaction = clamp(e.satisfaction - 15, 0, 100);
        b.reputation = clamp(b.reputation - 8, 0, 1000);
        message = "你拖着没发工资，员工眼神变了。";
      }
      break;
    }
    case "pipe_burst": {
      if (optionId === "pro") {
        const c = spend(180000, "repair", "水管专业维修");
        effBoost("水管停工整理", 9500, 1);
        message = `专业维修到场，${Math.floor(c / 100)} 元换来明天半天停业整理。明日客流-5%。`;
      } else if (optionId === "diy") {
        const avgSkill = b.staff.length ? Math.round(b.staff.reduce((a, e) => a + e.skill, 0) / b.staff.length) : 30;
        let c = spend(50000, "repair", "员工自救修水管");
        effBoost("自救修管", 9000, 1);
        if (avgSkill < 45) {
          const extra = spend(100000, "repair", "维修能力不足二次报修");
          message = `员工鼓捣了一晚上没修好，第二天还是请了师傅。共支出 ${Math.floor((c + extra) / 100)} 元。明日客流-10%。`;
        } else {
          message = `后厨藏着个水电高手，五十块钱的管件搞定。明日客流-10%（拖地晾地板）。`;
        }
      } else {
        repBy(-2);
        effBoost("接水营业", 9200, 3);
        b.store.hygiene = clamp(b.store.hygiene - 8, 0, 100);
        message = "三个脸盆接水，叮叮咚咚响了一整晚。顾客拍照发了网上：「本店自带水景」。口碑-2，未来3天客流-8%。";
      }
      break;
    }
    case "storm_day": {
      if (optionId === "warm_set") {
        spend(30000, "marketing", "雨天套餐宣传");
        repBy(2);
        effBoost("雨天热乎套餐", 11200, 2);
        message = "「下雨天，热汤面更配。」海报贴出去的两天里，店里总飘着蒸汽。口碑+2，未来2天客流+12%。";
      } else if (optionId === "normal") {
        effBoost("暴雨冷场", 7500, 1);
        message = "雨大到外卖骑手都罢工了。明日客流-25%。";
      } else {
        spend(20000, "spoil", "提前打烊食材损耗");
        effBoost("暴雨早退", 9000, 1);
        message = "备好的菜没卖完，提前拉下卷帘门。多耗损200元，明日客流-10%。";
      }
      break;
    }
    case "old_man_noodle": {
      if (optionId === "side_dish") {
        spend(8000, "cogs", "送老人的小菜");
        repBy(3);
        effBoost("一碗面的常客", 10300, 3);
        message = "第八天，你往他的面里加了碟卤豆干。他愣了一下，没说话，但坐到了打烊。口碑+3，未来3天客流+3%。";
      } else if (optionId === "chat") {
        repBy(2);
        b.reviews.unshift({ day: s.day, segName: "靠窗的老人", dishName: "招牌面", score: 5, text: "他说儿子生前最爱坐这个位子。这碗面，他要替儿子继续吃下去。" });
        message = "他絮絮叨聊了半小时儿子、老伴和过去的巷子。你添了次免费的热茶。口碑+2——这段故事留在了店里。";
      } else {
        message = "你照常下面、照常收碗。有些陪伴不需要台词。";
      }
      break;
    }
    case "kid_painting": {
      if (optionId === "hang") {
        spend(2000, "other", "装裱小朋友的画");
        repBy(2);
        effBoost("墙上的画", 10200, 3);
        message = "画被裱起来挂在收银台上方，「老板」被画成了太阳公公。口碑+2，未来3天客流+2%。";
      } else if (optionId === "thank") {
        repBy(2);
        message = "你郑重其事地和小朋友握了手。ta说要回去告诉妈妈这家店的老板笑得和画里一样。口碑+2。";
      } else {
        message = "画被夹进了收银台的抽屉，和围裙、备用纽扣躺在一起。";
      }
      break;
    }
    case "staff_birthday": {
      if (optionId === "supper") {
        spend(30000, "other", "员工宵夜庆生");
        for (const e of b.staff) { e.satisfaction = clamp(e.satisfaction + 10, 0, 100); e.loyalty = clamp(e.loyalty + 10, 0, 100); }
        message = "插着筷子的蛋糕，配一顿全体宵夜。有人许愿：明年还在这干。全员满意/忠诚+10。";
      } else {
        spend(5000, "other", "生日蛋糕蜡烛");
        for (const e of b.staff) { e.satisfaction = clamp(e.satisfaction + 5, 0, 100); e.loyalty = clamp(e.loyalty + 5, 0, 100); }
        message = "你们分掉了那个歪歪扭扭的蛋糕，补买的蜡烛插了三根才凑齐年龄数。全员满意/忠诚+5。";
      }
      break;
    }
    case "thanks_letter": {
      if (optionId === "keep") {
        repBy(2);
        message = "纸条进了纪念盒，和上个月的发票、半截铅笔放在一起。口碑+2。";
      } else if (optionId === "display") {
        spend(1000, "other", "展示感谢信物料");
        repBy(3);
        effBoost("无名的纸条", 10200, 3);
        message = "纸条被塑封贴在进门处，没有署名，也没有日期。口碑+3，未来3天客流+2%。";
      } else {
        spend(5000, "other", "加深卫生检查");
        repBy(1);
        message = "你把纸条折好收进围裙口袋，转身把冰箱温度和消毒柜又查了一遍。口碑+1。";
      }
      break;
    }
    case "giant_cabbage": {
      if (optionId === "limited_dish") {
        const c = earn(50000, "revenue", "巨型白菜限量菜");
        repBy(2);
        effBoost("比脸大的白菜", 10800, 2);
        message = `「本店今日供应：比脸大的白菜。」两小时售罄，排队的人举着手机拍。入账 ${Math.floor(c / 100)} 元，口碑+2，未来2天客流+8%。`;
      } else {
        spend(10000, "other", "退货运输损耗");
        message = "你坚持退了货。供应商开车拉走白菜时，围观街坊都想追出去买。";
      }
      break;
    }
    case "frog_takeover": {
      if (optionId === "lost_found") {
        spend(1000, "other", "失物招领整理");
        message = "10只青蛙被码放在失物招领箱，表情安详。";
      } else if (optionId === "corner") {
        spend(10000, "other", "青蛙专属角落");
        repBy(2);
        effBoost("青蛙角", 10500, 3);
        message = "青蛙们有了自己的沙发区，成为进店必合影点位。口碑+2，未来3天客流+5%。";
      } else {
        repBy(1);
        effBoost("命名青蛙", 10300, 2);
        message = "你给它们编了号，老十被贴了「本店荣誉店长」。口碑+1，未来2天客流+3%。";
      }
      break;
    }
    case "epic_bad_review": {
      if (optionId === "reply_all") {
        spend(5000, "other", "逐条回复打印费");
        repBy(1);
        message = "你逐条回复了三千字，比原文还长。围观群众分不清谁才是甲方。口碑+1。";
      } else if (optionId === "core_only") {
        repBy(2);
        message = "你只回复了「汤已降温出品」，附后厨温度计照片。路人好感+2。";
      } else {
        repBy(-1);
        message = "「筷子没气势」成了员工休息室保留段子。笑归笑，截图也传出去了。口碑-1。";
      }
      break;
    }
    case "cat_manager": {
      if (optionId === "find_owner") {
        spend(3000, "other", "寻猫启事与安置");
        repBy(1);
        message = "猫的主人半小时后赶到，是隔壁楼的下班族。它临走前巡视了一圈收银台。口碑+1。";
      } else if (optionId === "photo") {
        spend(2000, "other", "猫店长拍照周边");
        repBy(2);
        effBoost("猫店长上线", 11400, 2);
        message = "「本店今日由猫代管。」照片刷屏同城。口碑+2，未来2天客流+14%。";
      } else {
        spend(10000, "other", "吉祥物置办");
        repBy(2);
        effBoost("正式编制：猫", 11500, 3);
        message = "你给它做了工牌：店长助理·兼气氛组组长。口碑+2，未来3天客流+15%。";
      }
      break;
    }
    case "tax_flavor_review": {
      if (optionId === "ask_detail") {
        repBy(1);
        message = "你认真请教「税收味」的具体层次，对方居然真的给出了三段改进建议。口碑+1。";
      } else if (optionId === "record") {
        repBy(2);
        message = "「童年/房贷/税收」被记进意见簿，成了员工培训案例。口碑+2。";
      } else {
        const dRep = rndInt(s, -1, 3);
        repBy(dRep);
        message = `「免税套餐」的梗让对方笑出了声，${dRep >= 0 ? `发了一条好评，口碑+${dRep}` : `评论区有人说你油嘴滑舌，口碑${dRep}`}。`;
      }
      break;
    }
    case "art_plating": {
      if (optionId === "plate_it") {
        spend(12000, "other", "艺术摆盘手工费");
        repBy(2);
        effBoost("可食用的空间叙事", 10400, 2);
        message = "三菜一汤被你把摆出了展览的疏密感，对方拍了四十张照片。口碑+2，未来2天客流+4%。";
      } else if (optionId === "explain") {
        message = "你如实介绍本店定位：实惠、管饱。对方沉吟片刻，又加了一份米粉。";
      } else {
        const dRep = rndInt(s, -2, 4);
        repBy(dRep);
        spend(2000, "other", "菜单立牌");
        message = `《空盘前的沉思》印上了当日特牌，${dRep >= 0 ? `文艺青年闻风而至，口碑+${dRep}` : `被老客吐槽整花活，口碑${dRep}`}。`;
      }
      break;
    }
    case "rival_new_shop": {
      if (optionId === "optimize") {
        spend(30000, "other", "菜单成本优化咨询");
        repBy(2);
        effBoost("卷回来的菜单", 10500, 3);
        message = "你重排了菜单、抠掉了三道高价低走的菜。口碑+2，未来3天客流+5%。";
      } else if (optionId === "promo") {
        spend(50000, "marketing", "对新店限时促销");
        repBy(1);
        effBoost("限时促销应战", 11000, 3);
        message = "「开业同价周」海报贴到了新店对面。毛利薄了，人气足了。口碑+1，未来3天客流+10%。";
      } else {
        repBy(1);
        message = "你尝了对家的招牌菜，回来给自己的锅加了把火。特色这东西，抄不走。口碑+1。";
      }
      break;
    }
    default:
      message = "（未定义的事件效果）";
  }
  remove();
  return { message };
}

import { addLotFromBuy } from "./inventory";
function addLotFromBuyLocal(s: GameState, b: Branch, ingId: string, perPurchase: number): void {
  const def = ING_BY_ID[ingId];
  if (!def) return;
  const m = b.market[ingId];
  addLotFromBuy(b, def, Math.round(m.priceCents * 1.1), 5000, s.day);
  void perPurchase;
}

// 过期未处理事件：按被动默认项处理（无指定时取最后一个偏保守选项）
export function expirePendingEvents(s: GameState): void {
  const expired = s.events.pending.filter((p) => !p.blocking && s.day - p.createdAtDay >= EVENTS.pendingExpireDays);
  for (const p of expired.slice()) {
    const def = findDef(p.defId);
    const fallback = def?.defaultOptionId && p.options.some((o) => o.id === def.defaultOptionId)
      ? def.defaultOptionId
      : (p.options[p.options.length - 1]?.id ?? "expire");
    resolveEvent(s, p.eventUid, fallback);
  }
}

// ---------------- 中文映射（历史/待办展示用） ----------------
export const ZH_EVENT_TITLES: Record<string, string> = {
  bug_complaint: "顾客声称吃到虫子", blogger_dropin: "探店博主到店", interview_visitor: "采访博主到店",
  price_spike: "原材料涨价/缺货", equip_failure: "设备故障", staff_resign: "核心员工离职",
  competitor_open: "隔壁竞争店开业", long_queue: "顾客大量排队", bad_review_spread: "负面评价传播",
  supplier_default: "供应商临时违约", vip_request: "熟客特殊要求", expiry_alarm: "食材过期提醒",
  grandma_health: "奶奶病情反复", community_help: "社区帮扶", business_advice: "家庭商业建议",
  lie_exposed: "谎言被揭穿", holiday_promo: "节假日营销", parent_call: "父母来电",
  wage_crisis: "资金危机", pious_reporter: "中国大孝子·记者来访", genshin: "原来你也玩原神",
  marriage: "催婚", divorce: "感情破裂", fake_parents: "抱错孩子的假父母",
  yuzhou_flood: "禹州水灾", staff_troubled: "员工的心事", staff_family_hardship: "家庭的变故",
  lottery: "捡到彩票", staff_early_leave: "员工想早退", harassment: "邻桌的骚扰", experiment_result: "实验菜处理",
  pipe_burst: "后厨水管爆了", storm_day: "暴雨天，没人来了", old_man_noodle: "老人每天都来吃同一道菜",
  kid_painting: "小朋友画了一张画", staff_birthday: "员工偷偷给你过生日", thanks_letter: "一张没有署名的感谢信",
  giant_cabbage: "一颗比脸还大的白菜", frog_takeover: "全店被青蛙玩偶占领", epic_bad_review: "顾客提交了三千字差评",
  cat_manager: "一只猫宣布自己才是老板", tax_flavor_review: "顾客说你的菜吃出了税收的味道",
  art_plating: "顾客要求把菜摆得像艺术展", rival_new_shop: "隔壁开了一家同类型餐厅",
};

export const ZH_OPTION_TITLES: Record<string, Record<string, string>> = {
  bug_complaint: { pay_full: "全款赔偿", deny: "拒绝承认", suspend: "停菜检查" },
  blogger_dropin: { normal: "正常出餐", extra: "加量接待", gift: "赠送招牌菜", meal: "提供套餐", refuse: "拒绝接待" },
  interview_visitor: { answer: "接受采访" },
  price_spike: { deposit: "锁定保供", buy_now: "溢价调货", wait: "等待回落" },
  equip_failure: { repair: "立即维修", degraded: "带病运转", replace: "直接换新" },
  staff_resign: { raise: "加薪挽留", talk: "谈心挽留", letgo: "放行" },
  competitor_open: { price_war: "跟进价格战", quality: "死磕品质", ignore: "无视" },
  long_queue: { open_all: "全时段加开", free_tea: "发饮品安抚", limit: "限流赶客" },
  bad_review_spread: { apologize: "道歉整改", pr: "投放公关", fight: "回怼网友" },
  supplier_default: { claim: "按合同索赔", switch: "认栽换商", blacklist: "拉黑自提" },
  vip_request: { accept: "接下定制单", decline: "婉拒" },
  expiry_alarm: { sell_cheap: "卖给大学生", better_mgmt: "加强管理", ignore: "直接扔掉" },
  grandma_health: { surgery: "手术治疗", conserve: "保守治疗", crowdfund: "社区众筹" },
  community_help: { accept: "接受帮扶", polite_decline: "婉拒" },
  business_advice: { research: "实地考察", ignore: "专注眼前" },
  lie_exposed: { admit: "坦诚道歉", double_down: "嘴硬到底" },
  holiday_promo: { festival_marketing: "节日营销", coast: "佛系过节" },
  parent_call: { accept: "接受转账", refuse: "拒绝" },
  wage_crisis: { hardship_loan: "应急贷款", sell_equipment: "变卖设备", family_help: "开口求助", stubborn: "硬撑" },
  pious_reporter: { honest: "如实相告", play_pious: "装老实人", hide: "隐瞒" },
  genshin: { play: "一起玩", nope: "不玩" },
  marriage: { arrange: "去相亲", refuse: "不相亲", gay: "坦白性取向" },
  divorce: { repair: "努力修复", split: "离婚分割" },
  fake_parents: { pay: "给钱息事宁人", deny: "否认", test: "亲子鉴定" },
  yuzhou_flood: { watch: "旁观", donate: "捐助物资" },
  staff_troubled: { ignore: "视而不见", care: "真切关心" },
  staff_family_hardship: { comfort: "安慰离职", money: "资助3000元" },
  lottery: { cash: "去兑奖", superstition: "交给片警" },
  staff_early_leave: { allow: "同意早退", deny: "拒绝" },
  harassment: { police: "报警", ignore: "无视", stand_up: "挺身而出" },
  experiment_result: { toss: "倒掉", serve: "送顾客试吃" },
  pipe_burst: { pro: "专业维修", diy: "员工自救", buckets: "拿盆接水" },
  storm_day: { warm_set: "雨天套餐", normal: "正常营业", early_close: "提前打烊" },
  old_man_noodle: { side_dish: "送小菜", chat: "陪聊", plain: "正常接待" },
  kid_painting: { hang: "挂画", thank: "道谢", tuck: "收起" },
  staff_birthday: { supper: "请宵夜", cake: "分蛋糕" },
  thanks_letter: { keep: "收进纪念盒", display: "匿名展示", check_hygiene: "自查卫生" },
  giant_cabbage: { limited_dish: "做成限量菜", refund: "退货" },
  frog_takeover: { lost_found: "失物招领", corner: "青蛙角落", name_them: "起名拍照" },
  epic_bad_review: { reply_all: "逐条回复", core_only: "只回食品问题", inside_joke: "当内部笑话" },
  cat_manager: { find_owner: "寻找主人", photo: "拍照留念", mascot: "封吉祥物" },
  tax_flavor_review: { ask_detail: "请教细节", record: "匿名记录", joke_back: "回梗免税套餐" },
  art_plating: { plate_it: "认真摆盘", explain: "解释实惠", name_it: "取名沉思" },
  rival_new_shop: { optimize: "优化菜单", promo: "限时促销", stick: "坚持特色" },
};

export function zhEvent(defId: string): string { return ZH_EVENT_TITLES[defId] ?? defId; }
export function zhOption(defId: string, optId: string): string { return ZH_OPTION_TITLES[defId]?.[optId] ?? optId; }
export function defType(defId: string): string { return EVENT_DEFS.find((d) => d.id === defId)?.type ?? ""; }
