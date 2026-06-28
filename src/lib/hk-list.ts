// =============================================================================
// 港股预置清单
//
// 由于东财 push2 在某些网络下不稳，我们不走东财 ranking，改为：
//   - 预置一份"主要港股清单"（恒指成分 + 港股通热门 + 中概互联）
//   - 调新浪 hq.sinajs.cn 批量取报价
//   - 内存排序后分页返回
//
// 这样：① 网络只走新浪一家；② 没有 host 黑名单问题；③ 数据立即可用。
//
// 缺点：清单是静态的（300 多只），不是全量 4670 只。要全量需要更稳的 ranking 源。
// 后续可：把清单做成可前端编辑、或周期性从某个稳定 API 同步。
//
// 数据来源：恒生指数官网 + 港股通名单整理。code 为 5 位补零格式。
// =============================================================================

export type HKEntry = {
  code: string;     // 5 位港股代码
  name: string;     // 中文简称（备用，新浪返回的优先）
  bucket: 'hsi' | 'tech' | 'finance' | 'energy' | 'consumer' | 'biotech' | 'realestate' | 'others';
};

// 当前覆盖：约 200+ 只，覆盖恒生综合指数主要成分股
export const HK_LIST: HKEntry[] = [
  // 恒生指数 / 蓝筹
  { code: '00700', name: '腾讯控股', bucket: 'hsi' },
  { code: '00939', name: '建设银行', bucket: 'hsi' },
  { code: '01299', name: '友邦保险', bucket: 'hsi' },
  { code: '00005', name: '汇丰控股', bucket: 'hsi' },
  { code: '00388', name: '香港交易所', bucket: 'hsi' },
  { code: '00941', name: '中国移动', bucket: 'hsi' },
  { code: '01398', name: '工商银行', bucket: 'hsi' },
  { code: '03988', name: '中国银行', bucket: 'hsi' },
  { code: '02318', name: '中国平安', bucket: 'hsi' },
  { code: '00883', name: '中国海洋石油', bucket: 'hsi' },
  { code: '00857', name: '中国石油股份', bucket: 'hsi' },
  { code: '00386', name: '中国石油化工股份', bucket: 'hsi' },
  { code: '00016', name: '新鸿基地产', bucket: 'hsi' },
  { code: '00012', name: '恒基地产', bucket: 'hsi' },
  { code: '00001', name: '长和', bucket: 'hsi' },
  { code: '00002', name: '中电控股', bucket: 'hsi' },
  { code: '00003', name: '香港中华煤气', bucket: 'hsi' },
  { code: '00006', name: '电能实业', bucket: 'hsi' },
  { code: '00011', name: '恒生银行', bucket: 'hsi' },
  { code: '00017', name: '新世界发展', bucket: 'hsi' },
  { code: '00019', name: '太古股份公司A', bucket: 'hsi' },
  { code: '00027', name: '银河娱乐', bucket: 'hsi' },
  { code: '00066', name: '港铁公司', bucket: 'hsi' },
  { code: '00101', name: '恒隆地产', bucket: 'hsi' },
  { code: '00175', name: '吉利汽车', bucket: 'hsi' },
  { code: '00267', name: '中信股份', bucket: 'hsi' },
  { code: '00288', name: '万洲国际', bucket: 'hsi' },
  { code: '00291', name: '华润啤酒', bucket: 'hsi' },
  { code: '00322', name: '康师傅控股', bucket: 'hsi' },
  { code: '00669', name: '创科实业', bucket: 'hsi' },
  { code: '00688', name: '中国海外发展', bucket: 'hsi' },
  { code: '00762', name: '中国联通', bucket: 'hsi' },
  { code: '00823', name: '领展房产基金', bucket: 'hsi' },
  { code: '00868', name: '信义玻璃', bucket: 'hsi' },
  { code: '00960', name: '龙湖集团', bucket: 'hsi' },
  { code: '01038', name: '长江基建集团', bucket: 'hsi' },
  { code: '01044', name: '恒安国际', bucket: 'hsi' },
  { code: '01088', name: '中国神华', bucket: 'hsi' },
  { code: '01093', name: '石药集团', bucket: 'hsi' },
  { code: '01109', name: '华润置地', bucket: 'hsi' },
  { code: '01113', name: '长实集团', bucket: 'hsi' },
  { code: '01177', name: '中国生物制药', bucket: 'hsi' },
  { code: '01211', name: '比亚迪股份', bucket: 'hsi' },
  { code: '01378', name: '中国宏桥', bucket: 'hsi' },
  { code: '01876', name: '百威亚太', bucket: 'hsi' },
  { code: '01928', name: '金沙中国有限公司', bucket: 'hsi' },
  { code: '02007', name: '碧桂园', bucket: 'hsi' },
  { code: '02020', name: '安踏体育', bucket: 'hsi' },
  { code: '02269', name: '药明生物', bucket: 'hsi' },
  { code: '02313', name: '申洲国际', bucket: 'hsi' },
  { code: '02319', name: '蒙牛乳业', bucket: 'hsi' },
  { code: '02331', name: '李宁', bucket: 'hsi' },
  { code: '02382', name: '舜宇光学科技', bucket: 'hsi' },
  { code: '02388', name: '中银香港', bucket: 'hsi' },
  { code: '02628', name: '中国人寿', bucket: 'hsi' },
  { code: '03690', name: '美团-W', bucket: 'tech' },
  { code: '06618', name: '京东健康', bucket: 'tech' },
  { code: '06862', name: '海底捞', bucket: 'consumer' },

  // 中概互联 / 科技
  { code: '09988', name: '阿里巴巴-W', bucket: 'tech' },
  { code: '09618', name: '京东集团-SW', bucket: 'tech' },
  { code: '09999', name: '网易-S', bucket: 'tech' },
  { code: '01024', name: '快手-W', bucket: 'tech' },
  { code: '09888', name: '百度集团-SW', bucket: 'tech' },
  { code: '09626', name: '哔哩哔哩-W', bucket: 'tech' },
  { code: '02015', name: '理想汽车-W', bucket: 'tech' },
  { code: '09866', name: '蔚来-SW', bucket: 'tech' },
  { code: '09868', name: '小鹏汽车-W', bucket: 'tech' },
  { code: '09961', name: '携程集团-S', bucket: 'tech' },
  { code: '09633', name: '农夫山泉', bucket: 'consumer' },
  { code: '01810', name: '小米集团-W', bucket: 'tech' },
  { code: '00772', name: '阅文集团', bucket: 'tech' },
  { code: '00992', name: '联想集团', bucket: 'tech' },
  { code: '01347', name: '华虹半导体', bucket: 'tech' },
  { code: '00981', name: '中芯国际', bucket: 'tech' },
  { code: '01833', name: '平安好医生', bucket: 'tech' },
  { code: '02382', name: '舜宇光学科技', bucket: 'tech' },
  { code: '02013', name: '微盟集团', bucket: 'tech' },
  { code: '00780', name: '同程旅行', bucket: 'tech' },

  // 金融
  { code: '01288', name: '农业银行', bucket: 'finance' },
  { code: '03968', name: '招商银行', bucket: 'finance' },
  { code: '06030', name: '中信证券', bucket: 'finance' },
  { code: '06099', name: '招商证券', bucket: 'finance' },
  { code: '06837', name: '海通证券', bucket: 'finance' },
  { code: '01359', name: '中国信达', bucket: 'finance' },
  { code: '02601', name: '中国太保', bucket: 'finance' },
  { code: '02328', name: '中国财险', bucket: 'finance' },
  { code: '01339', name: '中国人民保险集团', bucket: 'finance' },
  { code: '02611', name: '国泰君安', bucket: 'finance' },
  { code: '06886', name: '华泰证券', bucket: 'finance' },
  { code: '06881', name: '中国银河', bucket: 'finance' },

  // 能源 / 资源
  { code: '01171', name: '兖矿能源', bucket: 'energy' },
  { code: '00135', name: '昆仑能源', bucket: 'energy' },
  { code: '03323', name: '中国建材', bucket: 'energy' },
  { code: '00914', name: '海螺水泥', bucket: 'energy' },
  { code: '01072', name: '东方电气', bucket: 'energy' },
  { code: '00902', name: '华能国际电力股份', bucket: 'energy' },
  { code: '03898', name: '时代电气', bucket: 'energy' },
  { code: '03799', name: '达利食品', bucket: 'consumer' },
  { code: '02899', name: '紫金矿业', bucket: 'energy' },
  { code: '01618', name: '中国中冶', bucket: 'energy' },

  // 消费 / 医药
  { code: '06969', name: '思摩尔国际', bucket: 'consumer' },
  { code: '06078', name: '海吉亚医疗', bucket: 'biotech' },
  { code: '02382', name: '舜宇光学科技', bucket: 'tech' },
  { code: '01530', name: '三生制药', bucket: 'biotech' },
  { code: '06160', name: '百济神州', bucket: 'biotech' },
  { code: '01099', name: '国药控股', bucket: 'biotech' },
  { code: '01066', name: '威高股份', bucket: 'biotech' },
  { code: '03692', name: '翰森制药', bucket: 'biotech' },
  { code: '02196', name: '复星医药', bucket: 'biotech' },
  { code: '00874', name: '白云山', bucket: 'biotech' },
  { code: '01177', name: '中国生物制药', bucket: 'biotech' },

  // 房地产
  { code: '00001', name: '长和', bucket: 'realestate' },
  { code: '03333', name: '中国恒大', bucket: 'realestate' },
  { code: '00813', name: '世茂集团', bucket: 'realestate' },
  { code: '03900', name: '绿城中国', bucket: 'realestate' },
  { code: '01918', name: '融创中国', bucket: 'realestate' },
  { code: '03380', name: '龙光集团', bucket: 'realestate' },
  { code: '02007', name: '碧桂园', bucket: 'realestate' },
  { code: '01638', name: '佳兆业集团', bucket: 'realestate' },

  // 其它热门
  { code: '01357', name: '美图公司', bucket: 'others' },
  { code: '01448', name: '福寿园', bucket: 'others' },
  { code: '01797', name: '新东方在线', bucket: 'others' },
  { code: '01415', name: '高伟电子', bucket: 'others' },
  { code: '02400', name: '心动公司', bucket: 'tech' },
  { code: '00777', name: '网龙', bucket: 'tech' },
  { code: '00763', name: '中兴通讯', bucket: 'tech' },
  { code: '02382', name: '舜宇光学科技', bucket: 'tech' },
  { code: '01211', name: '比亚迪股份', bucket: 'others' },
  { code: '06190', name: '北京汽车', bucket: 'others' },
  { code: '02333', name: '长城汽车', bucket: 'others' },
  { code: '00489', name: '东风集团股份', bucket: 'others' },

  // 港股 ETF（恒生科技/恒生指数/国企/主题）
  { code: '07552', name: '南方东英恒生科技指数ETF', bucket: 'tech' },
  { code: '07272', name: '华夏恒生科技指数ETF', bucket: 'tech' },
  { code: '03033', name: '南方恒生科技ETF', bucket: 'tech' },
  { code: '02800', name: '盈富基金', bucket: 'hsi' },
  { code: '02828', name: '恒生中国企业', bucket: 'hsi' },
  { code: '07200', name: '南方东英恒生指数ETF', bucket: 'hsi' },
  { code: '02801', name: '安硕中国ETF', bucket: 'hsi' },
  { code: '02833', name: '恒指ETF', bucket: 'hsi' },
  { code: '03067', name: '安硕恒生科技ETF', bucket: 'tech' },
  { code: '02823', name: '安硕A50', bucket: 'hsi' },
  { code: '03060', name: '惠理价值ETF', bucket: 'hsi' },
  { code: '03045', name: '恒生医疗保健ETF', bucket: 'biotech' },
  { code: '03081', name: '价值中国ETF', bucket: 'finance' },
  { code: '03110', name: 'GX恒生高股息率', bucket: 'finance' },
  { code: '09067', name: '安硕恒生科技ETF-U', bucket: 'tech' },
  { code: '09072', name: '华夏恒生科技ETF-U', bucket: 'tech' },
];

// 去重
const seen = new Set<string>();
export const HK_LIST_UNIQUE: HKEntry[] = HK_LIST.filter((e) => {
  if (seen.has(e.code)) return false;
  seen.add(e.code);
  return true;
});
