/**
 * 种子数据：造 3 个已生成好的应用 + 每条若干真实记录。
 * 作用有两个：1) 让工作台一打开就有东西看；2) 作为演示当天的降级入口（见 docs/12）。
 */
import { createAppFromSpec, insertRecord } from '../src/lib/data';
import { specFromPrompt } from '../src/lib/agent/templates';

type Seeded = {
  prompt: string;
  records: Array<Record<string, unknown>>;
};

const SEEDS: Seeded[] = [
  {
    prompt: '设备报修工单登记，记录设备编号、故障描述、报修人、紧急程度和处理状态',
    records: [
      { deviceNo: 'EQ-2031', deviceName: '注塑机 A3', fault: '主轴有金属摩擦声，夜班已停机', reporter: '陈建国', urgency: '停机待修', status: '维修中', reportDate: '2026-10-21', cost: 1800 },
      { deviceNo: 'EQ-1107', deviceName: '空压机 2 号', fault: '压力表读数波动，疑似漏气', reporter: '刘海', urgency: '紧急', status: '待派单', reportDate: '2026-10-23' },
      { deviceNo: 'EQ-3320', deviceName: '包装线传送带', fault: '传送带跑偏，产品堆积', reporter: '周敏', urgency: '一般', status: '已完工', reportDate: '2026-10-19', cost: 260 },
      { deviceNo: 'EQ-2044', deviceName: '注塑机 B1', fault: '加热圈温度不达标', reporter: '陈建国', urgency: '紧急', status: '已完工', reportDate: '2026-10-17', cost: 940 },
      { deviceNo: 'EQ-5012', deviceName: '冷水机组', fault: '冷凝器结垢严重，制冷效率下降', reporter: '王涛', urgency: '一般', status: '待派单', reportDate: '2026-10-24' },
    ],
  },
  {
    prompt: '我要做一个门店巡检登记，记录门店、区域、巡检日期、得分、是否整改',
    records: [
      { store: '深圳福田店', area: '华南', inspectDate: '2026-10-18', inspector: '陈晨', score: 92, fixed: true, issue: '收银台物料摆放不规范，已现场整改' },
      { store: '深圳南山店', area: '华南', inspectDate: '2026-10-19', inspector: '李伟', score: 78, fixed: false, issue: '消防通道堆放纸箱，需当日清理' },
      { store: '上海静安店', area: '华东', inspectDate: '2026-10-20', inspector: '王芳', score: 85, fixed: true, issue: '试衣间镜子松动，已报修' },
      { store: '北京朝阳店', area: '华北', inspectDate: '2026-10-21', inspector: '张敏', score: 96, fixed: true, issue: '无重大问题，陈列标准执行到位' },
      { store: '成都锦江店', area: '西南', inspectDate: '2026-10-22', inspector: '刘洋', score: 71, fixed: false, issue: '冷柜温度记录缺失，责令补齐' },
      { store: '杭州西湖店', area: '华东', inspectDate: '2026-10-23', inspector: '赵磊', score: 88, fixed: true, issue: '门口地贴翘边，已更换' },
    ],
  },
  {
    prompt: '做一个员工费用报销登记，包含部门、金额、费用类型、发票号和是否打款',
    records: [
      { applicant: '周舟', dept: '销售部', amount: 1280, category: '差旅', spendDate: '2026-10-12', invoiceNo: 'INV-20261012-01', paid: true, note: '广州客户拜访往返高铁与住宿' },
      { applicant: '孙倩', dept: '市场部', amount: 4600, category: '业务招待', spendDate: '2026-10-14', invoiceNo: 'INV-20261014-07', paid: false, note: '渠道合作伙伴季度沟通会' },
      { applicant: '吴昊', dept: '技术部', amount: 349, category: '办公用品', spendDate: '2026-10-16', invoiceNo: 'INV-20261016-12', paid: true, note: '开发用机械键盘' },
      { applicant: '郑楠', dept: '运营部', amount: 890, category: '差旅', spendDate: '2026-10-18', invoiceNo: 'INV-20261018-03', paid: false, note: '门店巡检出差' },
    ],
  },
  {
    prompt: '销售线索登记，记录公司、联系人、电话、跟进阶段和预估金额',
    records: [
      { company: '禾木科技', contact: '林总', phone: '13800001111', stage: '已报价', amount: 120000, followDate: '2026-10-28', owner: 'demo', note: '需要私有化部署方案' },
      { company: '南岭物流', contact: '何经理', phone: '13900002222', stage: '已联系', amount: 45000, followDate: '2026-10-27', owner: 'demo', note: '关注对接现有 ERP' },
      { company: '星野零售', contact: '苏女士', phone: '13700003333', stage: '已成交', amount: 88000, followDate: '2026-11-05', owner: 'demo', note: '首期上线 20 家门店' },
    ],
  },
];

async function main() {
  console.log('开始写入种子数据…');
  for (const seed of SEEDS) {
    const { spec } = specFromPrompt(seed.prompt);
    const { app, shareToken } = await createAppFromSpec({
      spec,
      prompt: seed.prompt,
      model: 'seed',
    });
    for (const record of seed.records) {
      await insertRecord(app.id, spec.entities[0].key, record);
    }
    console.log(`  ✓ ${spec.app.name}  (${seed.records.length} 条)  /p/${shareToken}`);
  }
  console.log('完成。打开 http://localhost:3000 查看。');
  process.exit(0);
}

main().catch((err) => {
  console.error('种子数据写入失败：', err);
  process.exit(1);
});
