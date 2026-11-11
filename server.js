/**
 * 书循环 · 简易安全支付后端
 * 价格服务端锁定 + 支付状态只能由服务端变更
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const RATE = 0.03;
const DATA_FILE = path.join(__dirname, 'data.json');

let store = {
  books: [
    { id: 1, title: "化工原理（上册）第5版", course: "化工原理 / 王老师班", cat: "专业教材", orig: 59, price: 20, cond: "有笔记标注", seller: "大三·陈学长", note: "含手写期末重点整理，8栋可自提", sold: false, uid: "seller001" },
    { id: 2, title: "物理化学（第五版）下册", course: "物理化学 / 李老师班", cat: "专业教材", orig: 62, price: 25, cond: "九成新", seller: "考研上岸·周学姐", note: "考研上岸出书，几乎没写字", sold: false, uid: "seller002" },
    { id: 3, title: "有机化学（第八版）", course: "有机化学", cat: "专业教材", orig: 69, price: 28, cond: "八成新", seller: "大四·刘同学", note: "习题详解另送", sold: false, uid: "seller003" },
    { id: 4, title: "高等数学（同济第七版）上", course: "高等数学A", cat: "公共课", orig: 49, price: 15, cond: "有笔记标注", seller: "大二·小张", note: "前三章有铅笔笔记，可擦", sold: false, uid: "seller004" },
    { id: 5, title: "新视野大学英语读写教程3", course: "大学英语（三）", cat: "公共课", orig: 55, price: 12, cond: "九成新", seller: "大三·Amy", note: "过了六级，书九九新", sold: false, uid: "seller005" },
    { id: 6, title: "考研英语真题黄皮书", course: "考研英语一", cat: "考研考证", orig: 89, price: 35, cond: "轻微磨损", seller: "研一·学长", note: "2026版，答案解析齐全", sold: false, uid: "seller006" },
    { id: 7, title: "化学反应工程（第三版）", course: "反应工程", cat: "专业教材", orig: 58, price: 22, cond: "九成新", seller: "大四·老王", note: "期末划的重点全在书里", sold: false, uid: "seller007" },
    { id: 8, title: "线性代数（同济第六版）", course: "线性代数", cat: "公共课", orig: 32, price: 10, cond: "八成新", seller: "大二·小李", note: "期末91分，沾沾喜气", sold: false, uid: "seller008" }
  ],
  wanted: [],
  msgs: {},
  orders: []
};

try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (loaded && Array.isArray(loaded.books) && loaded.books.length > 0) {
      store = loaded;
      console.log('已加载本地 data.json');
    }
  }
} catch (e) {
  console.warn('加载 data.json 失败，使用内置示例数据');
}

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('持久化失败', e.message);
  }
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 静态托管前端页面
app.use(express.static(__dirname));

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function findBook(id) {
  return store.books.find(b => String(b.id) === String(id));
}

function findOrder(id) {
  return store.orders.find(o => o.id === id);
}

function getUser(req) {
  return {
    id: req.headers['x-user-id'] || 'anonymous',
    name: decodeURIComponent(req.headers['x-user-name'] || '匿名同学')
  };
}

// --------------- 数据同步（兼容原前端） ---------------
app.get('/api/data', (req, res) => {
  res.json(store);
});

app.post('/api/data', (req, res) => {
  const { books, wanted, msgs, orders } = req.body || {};
  if (Array.isArray(books)) store.books = books;
  if (Array.isArray(wanted)) store.wanted = wanted;
  if (msgs && typeof msgs === 'object') store.msgs = msgs;
  if (Array.isArray(orders)) store.orders = orders;
  persist();
  res.json(store);
});

// --------------- 安全支付接口 ---------------

/** 创建预支付订单（服务端锁定价格） */
app.post('/api/order/create', (req, res) => {
  const user = getUser(req);
  const { bookId } = req.body || {};

  if (!bookId) return res.status(400).json({ ok: false, msg: '缺少 bookId' });

  const book = findBook(bookId);
  if (!book) return res.status(404).json({ ok: false, msg: '书籍不存在' });
  if (book.sold) return res.status(400).json({ ok: false, msg: '书籍已被买走' });
  if (book.uid && book.uid === user.id) {
    return res.status(400).json({ ok: false, msg: '不能购买自己发布的书' });
  }

  const exist = store.orders.find(
    o => String(o.bookId) === String(book.id) && o.buyerUid === user.id && o.status === 'created'
  );
  if (exist) {
    return res.json({ ok: true, order: exist, msg: '已有待支付订单' });
  }

  const price = money(book.price);
  if (!(price > 0)) return res.status(400).json({ ok: false, msg: '书籍价格异常' });

  const fee = money(price * RATE);
  const payout = money(price - fee);

  const order = {
    id: 'o' + Date.now() + '-' + uuidv4().slice(0, 8),
    bookId: book.id,
    title: book.title,
    price,
    fee,
    payout,
    buyerUid: user.id,
    buyerName: user.name,
    sellerUid: book.uid || '',
    sellerName: book.seller || '',
    status: 'created',
    createdAt: Date.now(),
    paidAt: null,
    clientNonce: uuidv4()
  };

  store.orders.unshift(order);
  persist();
  console.log(`[创建订单] ${order.id}  《${order.title}》  ¥${order.price}`);

  // fee / payout 仅服务端保存，不返回给买家前端
  res.json({
    ok: true,
    order: {
      id: order.id,
      title: order.title,
      price: order.price,
      status: order.status,
      clientNonce: order.clientNonce
    }
  });
});

/** 发起支付 */
app.post('/api/order/pay', (req, res) => {
  const user = getUser(req);
  const { orderId, clientNonce } = req.body || {};

  const order = findOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });
  if (order.buyerUid !== user.id) return res.status(403).json({ ok: false, msg: '无权操作此订单' });
  if (order.status !== 'created') {
    return res.status(400).json({ ok: false, msg: `订单当前状态为 ${order.status}，无法支付` });
  }
  if (order.clientNonce !== clientNonce) {
    return res.status(400).json({ ok: false, msg: 'nonce 不匹配，可能被重放' });
  }

  const book = findBook(order.bookId);
  if (!book || book.sold) {
    order.status = 'cancelled';
    persist();
    return res.status(400).json({ ok: false, msg: '书籍已不可售，订单已取消' });
  }

  order.status = 'paying';
  persist();

  const mockPayToken = 'mock_' + uuidv4();
  res.json({
    ok: true,
    msg: '请完成支付（演示环境可直接调用回调接口）',
    payToken: mockPayToken,
    orderId: order.id,
    amount: order.price
  });
});

/** 支付回调（模拟微信/支付宝异步通知） */
app.post('/api/pay/notify', (req, res) => {
  const { orderId, payToken, amount } = req.body || {};

  if (!orderId || !payToken) {
    return res.status(400).json({ ok: false, msg: '参数缺失' });
  }

  const order = findOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });

  if (order.status === 'paid' || order.status === 'done') {
    return res.json({ ok: true, msg: '订单已处理' });
  }

  if (order.status !== 'paying' && order.status !== 'created') {
    return res.status(400).json({ ok: false, msg: `订单状态异常: ${order.status}` });
  }

  if (money(amount) !== money(order.price)) {
    console.warn(`[金额不匹配] 订单${order.id} 期望${order.price} 实际收到${amount}`);
    return res.status(400).json({ ok: false, msg: '支付金额与订单不符' });
  }

  const book = findBook(order.bookId);
  if (!book) return res.status(400).json({ ok: false, msg: '书籍不存在' });
  if (book.sold) {
    order.status = 'cancelled';
    persist();
    return res.status(400).json({ ok: false, msg: '书籍已被其他人购买' });
  }

  order.status = 'paid';
  order.paidAt = Date.now();
  book.sold = true;

  const key = 'b_' + book.id;
  if (!store.msgs[key]) store.msgs[key] = [];
  store.msgs[key].push({
    id: 'm' + Date.now(),
    uid: order.buyerUid,
    name: order.buyerName,
    txt: `【已支付】¥${order.price.toFixed(2)}，约个时间交书吧！`,
    ts: Date.now()
  });

  persist();
  console.log(`[支付成功] ${order.id}  《${order.title}》  ¥${order.price}`);
  res.json({ ok: true, msg: '支付成功' });
});

/** 查询订单 */
app.get('/api/order/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });
  res.json({ ok: true, order });
});

/** 卖家确认完成 */
app.post('/api/order/confirm', (req, res) => {
  const user = getUser(req);
  const { orderId } = req.body || {};

  const order = findOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });
  if (order.sellerUid && order.sellerUid !== user.id) {
    return res.status(403).json({ ok: false, msg: '只有卖家可以确认完成' });
  }
  if (order.status !== 'paid') {
    return res.status(400).json({ ok: false, msg: '只有已支付订单可以确认完成' });
  }

  order.status = 'done';
  persist();
  res.json({ ok: true, msg: '交易已完成' });
});

/** 取消订单 */
app.post('/api/order/cancel', (req, res) => {
  const user = getUser(req);
  const { orderId } = req.body || {};

  const order = findOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });
  if (order.buyerUid !== user.id && order.sellerUid !== user.id) {
    return res.status(403).json({ ok: false, msg: '无权操作' });
  }
  if (!['created', 'paying'].includes(order.status)) {
    return res.status(400).json({ ok: false, msg: '当前状态不可取消' });
  }

  order.status = 'cancelled';
  persist();
  res.json({ ok: true, msg: '订单已取消' });
});

app.listen(PORT, () => {
  console.log(`书循环安全支付后端已启动 → http://localhost:${PORT}`);
  console.log(`前端页面请访问 → http://localhost:${PORT}/bookloop.html`);
  console.log('关键接口：');
  console.log('  POST /api/order/create   创建订单（锁定价格）');
  console.log('  POST /api/order/pay      发起支付');
  console.log('  POST /api/pay/notify     支付回调（模拟）');
  console.log('  GET  /api/order/:id      查询订单');
});
