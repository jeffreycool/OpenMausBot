// agentchat fork 本地改动：本 fork 团队自托管，不用上游的付费云（MausBot Cloud / Team Cloud）。给上游云做宣传、引导的提示，以及把答案记到上游
// Cloud Admin 的产品更新邮件订阅，在这里一律不出现：判定恒为 false，弹窗代码不执行；上游的代码结构保留（上游 merge 时删除本常量并还原用到它的
// 判定，见 agentchat/README.md「品牌重命名」登记表）。
export const AGENTCHAT_HIDE_UPSTREAM_CLOUD_NOTICES = true;
