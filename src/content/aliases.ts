import { normalizeTranscript } from './normalize';

/**
 * Names for the same thing, grouped. Members of a group are interchangeable
 * at grading time: answering any one of them counts for a question whose
 * `accept` list holds any other.
 *
 * This exists because the market does not agree on one name per product. A
 * subscription line is a subline, a subscription facility, a capital call
 * facility and an equity bridge facility — all in the same conversation. A
 * bank entry that only ever wrote one of them was marking the rest wrong, and
 * the Claude fallback that used to paper over it costs money, takes a network
 * round trip, and is unavailable offline. Put the vocabulary here once and
 * every question that names the concept inherits it.
 *
 * **Groups must be tight.** Membership is transitive, so a term that names
 * two different things in this bank belongs in neither group: bare "NAV" is
 * the value, "NAV facility" is the loan taken against it, and merging them
 * would grade a wrong answer right. When in doubt leave the ambiguous term
 * out and let it stay a per-question `accept` entry.
 *
 * Japanese and English forms live in the same group on purpose — the two
 * language banks ask the same questions, and a player who knows the term in
 * the other language knows the term.
 */
export const ALIAS_GROUPS: readonly (readonly string[])[] = [
  // ── Subscription (capital call) finance ────────────────────────────────
  [
    'Subscription Line',
    'サブスクリプションライン',
    'サブスクリプション・ライン',
    'サブライン',
    'Subline',
    'Sub-line',
    'Subscription Facility',
    'サブスクリプションファシリティ',
    'サブスクリプション・ファシリティ',
    'Subscription Credit Facility',
    'サブスクリプション・クレジット・ファシリティ',
    'Subscription Line of Credit',
    'Capital Call Facility',
    'キャピタルコールファシリティ',
    'キャピタルコール・ファシリティ',
    'Capital Call Line',
    'キャピタルコールライン',
    'Capital Call Credit Facility',
    'Capital Commitment Facility',
    'Equity Bridge Facility',
    'エクイティ・ブリッジ・ファシリティ',
    'エクイティブリッジファシリティ',
    'EBF',
    '資本コール枠',
    'キャピタルコール与信枠',
  ],
  [
    'Capital Call',
    'キャピタルコール',
    'キャピタル・コール',
    '資本コール',
    'コール',
    'Call',
    'Drawdown',
    'ドローダウン',
    'Capital Contribution Call',
    '払込請求',
    '出資請求',
  ],
  [
    '資本コール権',
    'キャピタルコール権',
    'コール権',
    'キャピタルコール請求権',
    '出資請求権',
    'Capital Call Rights',
  ],
  [
    'Uncalled Commitment',
    '未コールコミットメント',
    '未払込コミットメント',
    '未出資コミットメント',
    '未拠出コミットメント',
    'Unfunded Commitment',
    'アンファンデッドコミットメント',
    'アンファンデッド',
    'Uncalled Capital',
    'Undrawn Commitment',
    'Unfunded Capital',
    '未コール資本',
    '未払込出資約束',
  ],
  [
    'Borrowing Base',
    'ボローイングベース',
    'ボローイング・ベース',
    'ボロイングベース',
    '借入ベース',
    '借入基準額',
  ],
  [
    'Advance Rate',
    'アドバンスレート',
    'アドバンス・レート',
    '掛け目',
    'かけめ',
    '掛目',
    '前貸率',
  ],
  ['Haircut', 'ヘアカット', 'ヘアーカット', '掛け目控除', '評価控除'],
  [
    'Bridge',
    'ブリッジ',
    'ブリッジ資金',
    'つなぎ',
    'つなぎ資金',
    'ブリッジローン',
    'Bridge Loan',
    'Bridge Financing',
    'ブリッジファイナンス',
  ],
  [
    'Revolving',
    'リボルビング',
    'リボルバー',
    'Revolver',
    '回転',
    '回転信用枠',
    'Revolving Facility',
    'リボルビング・ファシリティ',
    'Revolving Credit Facility',
  ],
  ['Pro Rata', 'プロラタ', 'プロ・ラタ', '按分', 'あんぶん', '案分', '比例按分'],
  [
    'Concentration Risk',
    '集中リスク',
    '集中',
    '集中度',
    'Concentration',
    'LP集中度',
    '集中度リスク',
  ],
  ['Side Letter', 'サイドレター', 'サイド・レター', 'サイドレター契約'],
  ['一次返済原資', '一次原資', 'Primary Source of Repayment', '主たる返済原資'],

  // ── NAV finance ────────────────────────────────────────────────────────
  [
    'NAV Facility',
    'NAVファシリティ',
    'Net Asset Value Facility',
    'NAV Loan',
    'NAVローン',
    'NAV Line',
    'NAVライン',
    'NAV Financing',
    'NAVファイナンス',
    'NAV Lending',
    'NAVレンディング',
    'NAV Credit Facility',
    'NAV-based Facility',
    'NAV担保ローン',
  ],
  [
    'NAV',
    'Net Asset Value',
    'エヌエーブイ',
    '純資産価値',
    '純資産',
    'ナブ',
    'ネットアセットバリュー',
  ],
  [
    'Hybrid',
    'ハイブリッド',
    'Hybrid Facility',
    'ハイブリッドファシリティ',
    'ハイブリッド・ファシリティ',
    'Hybrid Line',
    'ハイブリッドライン',
    'ハイブリッド型ファシリティ',
  ],
  [
    'LTV',
    'Loan to Value',
    'Loan-to-Value',
    'エルティーブイ',
    'ローントゥバリュー',
    'ローン・トゥ・バリュー',
    'LTV比率',
    '貸付価値比率',
  ],
  ['Eligibility Rate', '適格率', 'エリジビリティレート', '適格比率', '担保適格率'],
  ['Adjusted NAV', '調整済みNAV', '調整後NAV', 'アジャステッドNAV'],
  [
    'Asset-Backed',
    'アセットバックト',
    'アセットバック',
    'アセット・バックト',
    '資産担保型',
    '資産裏付型',
  ],
  [
    'Sweep',
    'スイープ',
    'Cash Sweep',
    'キャッシュスイープ',
    'キャッシュ・スイープ',
    '自動充当',
    '自動返済充当',
  ],
  ['Cash Trap', 'キャッシュ・トラップ', 'キャッシュトラップ', '資金留保', 'キャッシュ留保'],
  [
    'Account Control Agreement',
    '口座支配契約',
    'アカウントコントロール契約',
    'アカウント・コントロール契約',
    'ACA',
    'エーシーエー',
    'DACA',
    'Deposit Account Control Agreement',
    '口座管理契約',
    '預金口座支配契約',
  ],
  [
    'Perfection',
    'パーフェクション',
    '対抗要件具備',
    '対抗要件の具備',
    '対抗要件',
    '担保権の対抗要件',
    '第三者対抗要件',
  ],
  ['Legal Opinion', 'リーガルオピニオン', 'リーガル・オピニオン', '法律意見書', '意見書', '法的意見書'],
  ['Holdco', '持株会社', 'ホールドコー', 'ホールドコ', '中間持株会社'],

  // ── Leverage ───────────────────────────────────────────────────────────
  [
    'LBO',
    'Leveraged Buyout',
    'エルビーオー',
    'レバレッジド・バイアウト',
    'レバレッジドバイアウト',
  ],
  ['Back-Leverage', 'バックレバレッジ', 'バック・レバレッジ', 'back leverage'],
  [
    'CFO',
    'Collateralized Fund Obligation',
    '担保付ファンド債務証券',
    'シーエフオー',
    'ファンド債務担保証券',
  ],
  [
    'Full-Stack Leverage',
    'フル・スタック・レバレッジ',
    'フルスタックレバレッジ',
    '全層レバレッジ',
  ],
  [
    'Leverage Stacking',
    'レバレッジの二重計上',
    'レバレッジ・スタッキング',
    'レバレッジスタッキング',
    'レバレッジの積み上げ',
  ],
  ['PIK', 'Payment-in-Kind', 'Payment in Kind', 'ピック', '現物払い', '現物利払い'],
  [
    'Warehouse Facility',
    'ウェアハウス・ファシリティ',
    'ウェアハウスファシリティ',
    'ウェアハウス',
    'Warehouse',
    'Warehouse Line',
    'ウェアハウジング',
  ],
  ['無担保貸出', '担保なし貸出', '無担保', 'Unsecured Loan', '実質無担保'],

  // ── Fund documents & covenants ─────────────────────────────────────────
  [
    'LPA',
    'Limited Partnership Agreement',
    'エルピーエー',
    'リミテッドパートナーシップ契約',
    'リミテッド・パートナーシップ契約',
    '組合契約',
    'LP契約',
  ],
  [
    'Covenant',
    'Covenants',
    'コベナンツ',
    'コベナント',
    'カベナンツ',
    '誓約条項',
    '財務制限条項',
    '財務コベナンツ',
  ],
  ['Covenant-Lite', 'コベナンツ・ライト', 'コベナンツライト', 'Cov-Lite', '緩和コベナンツ'],
  [
    'Covenant Headroom',
    'コベナンツ・ヘッドルーム',
    'コベナンツヘッドルーム',
    'ヘッドルーム',
    'Headroom',
    'コベナンツ余裕度',
  ],
  ['Cure', 'Cure期間', 'キュア', 'キュア期間', 'Cure Period', '治癒期間', '猶予期間', '是正期間'],
  [
    'Acceleration',
    'アクセラレーション',
    '期限の利益の喪失',
    '期限の利益喪失',
    '期限利益喪失',
    '一括請求',
  ],
  [
    'Early Warning Threshold',
    '早期警戒ライン',
    '早期警戒水準',
    '早期警戒閾値',
    'アーリーウォーニング',
  ],
  [
    'MFN',
    'Most Favored Nation',
    '最恵国待遇条項',
    'エムエフエヌ',
    '最恵国条項',
    '最恵国待遇',
  ],
  ['Excuse Rights', 'エクスキューズ権', 'エクスキューズ・ライト', '免除権', '参加免除権', 'エクスキューズ条項'],
  [
    'Key Person',
    'Key Person Clause',
    'Key-Person Clause',
    'キーパーソン条項',
    'キーパーソン',
    'キーマン条項',
    'Key Man Clause',
    'キーマン',
    '主要人物条項',
  ],
  [
    'No-Fault Divorce',
    '無過失解消',
    'ノーフォルト・ディボース',
    '無過失解散',
    '無過失GP解任',
    'ノーフォルト条項',
  ],
  ['Transfer restrictions', '移転制限', '譲渡制限', 'トランスファー制限', '持分移転制限'],
  ['Precedence Clause', '優先条項', '優先順位条項', '序列条項'],
  ['LPA修正', '同意書', 'Amendment', 'LPAの修正', 'LPA改訂', 'LP同意', 'LP Consent'],

  // ── Economics: carry, waterfall, commitments ───────────────────────────
  [
    'Carried Interest',
    'キャリード・インタレスト',
    'キャリードインタレスト',
    'キャリー',
    'Carry',
    '成功報酬',
  ],
  ['Clawback', 'クローバック', 'GPクローバック', 'GP Clawback', '返還義務', 'キャリー返還義務'],
  ['GP Catch-Up', 'GPキャッチアップ', 'キャッチアップ', 'Catch-Up', '追いつき条項'],
  [
    'GP Commitment',
    'GPコミットメント',
    'GPコミット',
    'General Partner Commitment',
    'ジーピーコミットメント',
    'GP出資',
    'GP自己出資',
    'GP拠出',
  ],
  [
    'Waterfall',
    'ウォーターフォール',
    'ウォーター・フォール',
    '支払優先順位の構造',
    '支払優先順位',
    '分配順位',
    'Distribution Waterfall',
    '分配ウォーターフォール',
  ],
  [
    'Deal-by-Deal',
    'ディール・バイ・ディール方式',
    'ディールバイディール',
    '米国型',
    'アメリカン・ウォーターフォール',
    'American Waterfall',
    'US Waterfall',
    '米国型ウォーターフォール',
    '案件別方式',
  ],
  [
    'Whole-Fund',
    'ホール・ファンド方式',
    'ホールファンド',
    '欧州型',
    'European Waterfall',
    'ヨーロピアン・ウォーターフォール',
    '欧州型ウォーターフォール',
    'ファンド全体方式',
    'Whole of Fund',
  ],
  [
    'Recallable Distribution',
    'リコーラブル・ディストリビューション',
    'リコーラブルディストリビューション',
    '再拠出可能分配',
    'リコーラブル分配',
    '再コール可能分配',
  ],
  ['Recycling', 'リサイクル条項', 'リサイクル', 'リサイクリング', '再投資条項', '収益再投資'],
  ['Distribution', '分配金', '分配', 'ディストリビューション'],
  ['Exit', 'エグジット', 'イグジット', '出口', '出口戦略'],
  ['Investment Period', '投資期間', 'インベストメントピリオド', 'インベストメント・ピリオド', '投資実行期間'],
  ['Harvest Period', 'ハーベスト期間', 'ハーベスト期', '回収期間', '収穫期間'],
  ['Term Extension', '存続期間延長', '期間延長', 'ターム・エクステンション', 'ファンド期間延長'],
  ['Paid-In Capital', '払込資本', 'ペイドインキャピタル', '払込済資本', '払い込み資本'],
  ['Realized Value', '実現価値', 'リアライズドバリュー', '実現額', '実現済み価値'],

  // ── Structures & players ───────────────────────────────────────────────
  [
    'GP',
    'General Partner',
    'ジーピー',
    'ゼネラルパートナー',
    'ジェネラルパートナー',
    '無限責任組合員',
    '業務執行組合員',
  ],
  ['LP', 'Limited Partner', 'エルピー', 'リミテッドパートナー', '有限責任組合員'],
  [
    'FoF',
    'Fund of Funds',
    'ファンドオブファンズ',
    'エフオーエフ',
    'ファンド・オブ・ファンズ',
    'ファンズ・オブ・ファンズ',
  ],
  [
    'SWF',
    'Sovereign Wealth Fund',
    '政府系ファンド',
    'エスダブリューエフ',
    'ソブリンウェルスファンド',
    'ソブリン・ウェルス・ファンド',
    '国富ファンド',
  ],
  ['Family Office', 'ファミリーオフィス', 'ファミリー・オフィス', '資産管理会社'],
  ['AUM', 'Assets Under Management', 'エーユーエム', '運用資産総額', '運用資産残高'],
  ['ALM', 'Asset Liability Management', 'エーエルエム', '資産負債管理', '資産負債総合管理'],
  ['CIO', 'Chief Investment Officer', 'シーアイオー', '最高投資責任者'],
  ['SPV', 'Special Purpose Vehicle', 'エスピーブイ', '特別目的会社', 'SPC', '特別目的ビークル'],
  ['Feeder fund', 'フィーダーファンド', 'フィーダー・ファンド', 'フィーダー', '受け皿ファンド'],
  ['Blocker', 'ブロッカー', 'ブロッカー法人', 'Blocker Corporation', 'ブロッカー会社'],
  ['Parallel Fund', '並行ファンド', 'パラレルファンド', 'パラレル・ファンド', '並行運用ファンド'],
  ['AIV', 'Alternative Investment Vehicle', 'エーアイブイ', '代替投資ビークル', '代替投資媒体'],
  ['Joinder', 'ジョインダー', 'ジョインダー契約', '参加契約', 'Joinder Agreement', '加入契約'],
  ['Preferred Holder', 'プリファードホルダー', 'プリファード・ホルダー', '優先株保有SPV'],
  ['Side Pocket', 'サイド・ポケット', 'サイドポケット', 'サイドポケット勘定', '分別管理勘定'],
  [
    'Continuation Fund',
    '継続ファンド',
    'コンティニュエーション・ファンド',
    'コンティニュエーションファンド',
    'Continuation Vehicle',
    'コンティニュエーション・ビークル',
    'コンティニュエーションビークル',
    '継続ビークル',
    'GP主導型継続ファンド',
  ],

  // ── Performance metrics ────────────────────────────────────────────────
  ['DPI', 'Distributions to Paid-In', 'Distribution to Paid-In', 'ディーピーアイ', '分配倍率'],
  ['TVPI', 'Total Value to Paid-In', 'TVPI指標', 'ティーブイピーアイ', '総価値倍率'],
  ['RVPI', 'Residual Value to Paid-In', 'R.V.P.I.', 'アールブイピーアイ', '残余価値倍率'],
  ['IRR', 'Internal Rate of Return', 'アイアールアール', '内部収益率'],
  ['XIRR', 'XIRR関数', 'エックスアイアールアール', 'XIRR function'],
  ['PME', 'Public Market Equivalent', 'ピーエムイー', '公開市場等価', 'パブリック・マーケット・エクイバレント'],
  [
    'KS-PME',
    'Kaplan-Schoar Public Market Equivalent',
    'Kaplan-Schoar PME',
    'ケーエスピーエムイー',
    'カプラン・ショアPME',
  ],
  ['Direct Alpha', 'ダイレクトアルファ', 'ダイレクト・アルファ', '直接アルファ'],
  ['LN-PME', 'Long-Nickels PME', 'エルエヌピーエムイー', 'Long Nickels', 'ロング・ニッケルズPME'],
  ['mPME', 'Modified PME', 'エムピーエムイ', 'エムピーエムイー', '修正PME'],
  ['PME+', 'PME plus', 'ピーエムイープラス', 'PMEプラス'],
  ['Beta', 'β', 'ベータ', 'ベータ値', 'ベータ係数'],
  ['EBITDA倍率', 'EBITDAマルチプル', 'EBITDA Multiple', 'イービットダ倍率', 'EBITDA倍率法'],
  [
    'Vintage Year',
    'Vintage',
    'ビンテージ年',
    'ビンテージ',
    'ヴィンテージ',
    'ヴィンテージ年',
    'ビンテージイヤー',
  ],
  ['J-curve', 'Jカーブ', 'Jカーブ現象', 'ジェイカーブ', 'J曲線'],
  ['Quartile Rank', 'クォータイル・ランク', 'クォータイルランク', 'クオータイルランク', '四分位順位', '四分位ランク'],
  ['Mark-up', 'マークアップ', 'マーク・アップ', 'markup', '評価引き上げ', '評価額引き上げ'],
  [
    'Survivorship Bias',
    'サバイバーシップ・バイアス',
    'サバイバーシップバイアス',
    '生存者バイアス',
    '生存バイアス',
  ],
  [
    'FOIA Bias',
    'FOIAバイアス',
    'Freedom of Information Actバイアス',
    'フォイアバイアス',
    '情報公開バイアス',
  ],
  ['Smoothing', 'スムージング', '平滑化', '平準化'],
  ['De-Smoothing', 'デ・スムージング', 'デスムージング', '平滑化解除', 'アンスムージング', 'Unsmoothing'],
  [
    'Performance Persistence',
    'パフォーマンス持続性仮説',
    'パフォーマンス持続性',
    '実績持続性',
    'パフォーマンス・パーシステンス',
    '持続性仮説',
  ],

  // ── Valuation standards ────────────────────────────────────────────────
  ['ASC 820', 'ASC820', 'エーエスシーはちにーまる', 'ASC 820号'],
  ['IFRS 13', 'IFRS13', 'アイエフアールエスじゅうさん', 'IFRS第13号'],
  ['FAS 157', 'FAS157', 'エフエーエスひゃくごじゅうなな', 'FAS第157号'],
  ['Level 3', 'レベル3', 'レベルスリー', 'Level Three', '第3レベル'],
  ['Level 1', 'レベル1', 'レベルワン', 'Level One', '第1レベル'],
  ['DCF', 'Discounted Cash Flow', 'ディーシーエフ', '割引キャッシュフロー法', '将来キャッシュフロー割引法'],
  [
    'EBITDA',
    'Earnings Before Interest Taxes Depreciation and Amortization',
    'イービットダ',
    'イビットダー',
    '税引前利払前償却前利益',
  ],
  ['Realization Rate', '実現率', 'リアライゼーションレート', '実現倍率'],
  [
    'IPEV',
    'International Private Equity and Venture Capital Valuation Guidelines',
    'IPEVガイドライン',
    'アイペブ',
    'IPEV評価ガイドライン',
  ],
  ['FASB', 'Financial Accounting Standards Board', 'ファスビー', '米国財務会計基準審議会', '財務会計基準審議会'],
  ['IASB', 'International Accounting Standards Board', 'アイアスビー', '国際会計基準審議会'],

  // ── Regulation & reporting ─────────────────────────────────────────────
  ['Form ADV', 'フォームADV', 'ADV', 'ADV様式'],
  ['Form PF', 'フォームPF', 'PF様式'],
  [
    'AIFMD',
    'Alternative Investment Fund Managers Directive',
    'EU代替投資規制',
    'エーアイエフエムディー',
    '代替投資ファンド運用者指令',
  ],
  ['Annex IV', 'アネックスIV', 'アネックス4', 'Annex 4', '別紙IV'],
  ['ERISA', 'Employee Retirement Income Security Act', 'エリサ', 'エリサ法', '従業員退職所得保障法'],
  ['Plan Assets', 'プラン・アセット', 'プランアセット', '年金資産', 'プラン資産'],
  ['OFAC', 'Office of Foreign Assets Control', 'オーファック', '外国資産管理局'],
  ['Sovereign Immunity', '主権免除', '国家免除', 'ソブリン・イミュニティ', 'ソブリンイミュニティ'],
  ['Restrictive Sovereign Immunity', '制限的主権免除', '制限免除主義', '限定的主権免除'],
  ['GAAP', 'Generally Accepted Accounting Principles', '米国会計基準', 'ギャープ', 'US GAAP'],
  [
    'ILPA',
    'Institutional Limited Partners Association',
    'I.L.P.A.',
    'アイエルピーエー',
    '機関投資家LP協会',
  ],
  [
    'LPAC',
    'Limited Partner Advisory Committee',
    'エルパック',
    'LP諮問委員会',
    'LPアドバイザリー委員会',
    'エルピーエーシー',
  ],
  ['IAPD', 'Investment Adviser Public Disclosure', 'SEC IAPD', 'アイエーピーディー'],
  ['DDQ2.0', 'Due Diligence Questionnaire 2.0', 'DDQ 2.0', 'ディーディーキュートゥーテンゼロ', 'DDQ2'],
  ['SCR', 'Solvency Capital Requirement', 'エスシーアール', 'ソルベンシー資本要件'],
  ['MCR', 'Minimum Capital Requirement', '最低資本要件', 'エムシーアール', '最低必要資本'],
  ['SFCR', 'Solvency and Financial Condition Report', 'エスエフシーアール', 'ソルベンシー財務状況報告書'],
  ['LTE', 'Long-Term Equity', 'エルティーイー', '長期株式', '長期エクイティ'],
  ['Type 1 Equity', 'タイプ1エクイティ', 'Type 1', 'タイプ1', 'タイプワンエクイティ', 'タイプ1株式'],
  ['Symmetric Adjustment', '対称的調整', 'SA', 'シンメトリック・アジャストメント', '対称調整'],
  [
    'Mandate-Based Approach',
    'マンデート・ベースド・アプローチ',
    'マンデートベースドアプローチ',
    'マンデートベース・アプローチ',
  ],
  ['Look-Through Approach', 'ルックスルー・アプローチ', 'ルックスルーアプローチ', '見通しアプローチ'],
  ['EBA', 'European Banking Authority', 'イービーエー', '欧州銀行監督機構', '欧州銀行機構'],
  ['FSB', 'Financial Stability Board', 'エフエスビー', '金融安定理事会'],
  ['NBFI', 'Non-Bank Financial Institution', 'エヌビーエフアイ', 'ノンバンク金融仲介', '銀行以外の金融仲介'],
  ['OFR', 'Office of Financial Research', 'オーエフアール', '金融調査局'],
  ['Denominator Effect', 'デノミネーター効果', '分母効果', 'デノミネータ効果'],
  ['Redemption Run', '解約ラッシュ', '解約殺到', 'リデンプション・ラン', '解約集中'],

  // ── Analytics & forensics ──────────────────────────────────────────────
  ['Look-Through Analysis', 'ルックスルー分析', 'ルックスルー・アナリシス', 'ルック・スルー分析'],
  [
    'Overlapping Exposure',
    '重複エクスポージャー',
    '重複投資',
    'エクスポージャー重複',
    'オーバーラップ・エクスポージャー',
  ],
  ['Portfolio Report', 'ポートフォリオ・レポート', 'ポートフォリオレポート', '保有明細報告', 'ポートフォリオ報告書'],
  [
    'HHI',
    'Herfindahl-Hirschman Index',
    'エイチエイチアイ',
    'ハーフィンダール・ハーシュマン指数',
    'ハーフィンダール指数',
  ],
  ['LEI', 'Legal Entity Identifier', 'エルイーアイ', '法人識別子', '取引主体識別コード'],
  ['QE', 'Quantitative Easing', 'キューイー', '量的緩和', '量的金融緩和'],
  ['IPO', 'Initial Public Offering', 'アイピーオー', '新規株式公開', '株式新規公開'],
  [
    'Monte Carlo',
    'モンテカルロ法',
    'モンテ・カルロ法',
    'モンテカルロ',
    'Monte Carlo method',
    'モンテカルロ・シミュレーション',
    'モンテカルロシミュレーション',
  ],
  ['MLE', 'Maximum Likelihood Estimation', '最尤推定法', 'エムエルイー', '最尤推定', '最尤法'],
  ['LIFO', 'Last In First Out', '後入先出', 'ライフォ', '後入先出法'],
  ['FIFO', 'First In First Out', '先入先出', 'ファイフォ', '先入先出法'],
  ['Bipartite Graph', '二部グラフ', 'バイパータイトグラフ', '2部グラフ'],
  ['Galton-Watson', 'ガルトン・ワトソン過程', 'ガルトンワトソン過程', 'Galton-Watson process', 'ゴルトン・ワトソン過程'],
  [
    'Takahashi-Alexander Model',
    '高橋・アレクサンダー・モデル',
    '高橋アレクサンダー',
    '高橋アレクサンダーモデル',
    'TAモデル',
  ],
  ['Bow Factor', 'ボウ・ファクター', 'ボウファクター', 'bow factor', 'ボー・ファクター'],
  ['Stress Test', 'ストレステスト', 'ストレス・テスト', '耐性検査'],
  ['Scenario Analysis', 'シナリオ分析', 'シナリオ・アナリシス', 'シナリオ解析'],
  ['Hold-Sell Analysis', 'Hold-Sell分析', 'ホールドセル分析', '保有売却分析', 'ホールド・セル分析'],
  ['Audit Trail', '証跡', '監査証跡', 'オーディット・トレイル', '監査トレイル'],
  ['Second-Digit Test', '第二桁検定', 'セカンド検定', '第2桁検定', 'セカンドディジット検定'],

  // ── Manipulation patterns ──────────────────────────────────────────────
  ['Synthetic DPI', '合成DPI', 'シンセティックDPI', '人工DPI'],
  [
    'Broken-Deal Expense Allocation',
    '破綻案件費用配分',
    'ブロークンディール費用',
    '不成立案件費用配分',
    '破談案件費用配分',
  ],
  [
    'Cherry Picking',
    'チェリーピッキング',
    'コ・インベストのチェリーピッキング',
    'チェリー・ピッキング',
    'いいとこ取り',
  ],
  ['Valuation Manipulation', '評価操作', 'バリュエーション操作', '評価額操作', '評価の操作'],
  ['IRR Manipulation', 'IRR操作', 'IRRの操作', 'アイアールアール操作'],
  [
    'Fundraising-Period Markups',
    '募集期評価つり上げ',
    '募集期マークアップ',
    '資金調達期の評価引き上げ',
  ],
  ['Crystallization', '結晶化', 'クリスタライゼーション', 'キャリーの結晶化', '確定精算'],
  ['Fairness Opinion', 'フェアネスオピニオン', 'フェアネス・オピニオン', '公正意見書', '公正性意見書'],
  [
    'Stapled Commitment',
    'スタップルドコミットメント',
    'ステープルドコミットメント',
    'Staple',
    '抱き合わせコミットメント',
  ],
  [
    'Secondary Purchases',
    'セカンダリー購入',
    'セカンダリー取引',
    'セカンダリー',
    'Secondaries',
    'セカンダリー売買',
    'LP持分売買',
  ],

  // ── Fitch subscription-line rating ─────────────────────────────────────
  [
    'Payment Track Record',
    '支払い実績',
    '支払実績',
    'コール応答実績',
    'ペイメント・トラック・レコード',
    'コール履行実績',
  ],
  [
    'Weighted Average Credit Quality',
    '加重平均信用力',
    '加重平均信用格付',
    'WACQ',
    '加重平均クレジットクオリティ',
  ],
  ['LP Pool Monitoring', 'LPプール監視', 'LPプール・モニタリング', 'LPプールモニタリング', 'LP構成監視'],
  ['Remaining Commitment Period', '残存コミットメント期間', '残存コミット期間', '残余コミットメント期間'],
  ['1-Minus Test', '1-Minusテスト', 'ワンマイナステスト', '1マイナステスト', 'One-Minus Test'],
  ['BBC', 'Borrowing Base Certificate', 'ビービーシー', 'ボローイングベース証明書', '借入基準証明書'],
  ['平穏時の分散メリット', '分散メリット', '分散効果', '平時の分散効果'],
];

/**
 * Every alias, normalized, mapped to a stable id for its group. Built once at
 * module load; a term that lands in two groups is a bug in the table above
 * (membership is transitive, so it would silently merge them) and is caught
 * by aliases.test.ts rather than left to surface as a mis-graded answer.
 */
const GROUP_OF: Map<string, string> = (() => {
  const map = new Map<string, string>();
  ALIAS_GROUPS.forEach((group, index) => {
    const id = `g${index}`;
    for (const term of group) {
      map.set(normalizeTranscript(term), id);
    }
  });
  return map;
})();

/** Terms that appear in more than one group. Empty in a healthy table. */
export function aliasCollisions(): string[] {
  const seen = new Map<string, number>();
  const clashes: string[] = [];
  ALIAS_GROUPS.forEach((group, index) => {
    for (const term of group) {
      const key = normalizeTranscript(term);
      const first = seen.get(key);
      if (first === undefined) seen.set(key, index);
      else if (first !== index) clashes.push(term);
    }
  });
  return clashes;
}

/**
 * The form two answers are compared in: the alias group's id when the answer
 * names a known concept, the normalized text itself otherwise. Comparing
 * these instead of raw normalized strings is what makes "subline" and
 * "Subscription Facility" grade the same as "Subscription Line".
 */
export function canonicalAnswer(raw: string): string {
  const normalized = normalizeTranscript(raw);
  return GROUP_OF.get(normalized) ?? normalized;
}
