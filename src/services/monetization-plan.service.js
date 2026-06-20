const MonetizationPlan = require('../models/MonetizationPlan');
const { SUBSCRIPTION_PLANS, getPlanCode } = require('../config/payos.config');

const configToDocument = (plan) => ({
  code: plan.code,
  name: plan.name,
  priceMonthly: plan.priceMonthly,
  priceYearly: plan.priceYearly,
  features: plan.features,
  limits: plan.limits,
  benefits: plan.benefits,
  isActive: true,
  sortOrder: plan.sortOrder,
});

const getDefaultPlans = () => Object.values(SUBSCRIPTION_PLANS)
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(configToDocument);

const seedDefaultPlans = async () => {
  const plans = getDefaultPlans();
  await Promise.all(plans.map((plan) => MonetizationPlan.updateOne(
    { code: plan.code },
    { $set: plan },
    { upsert: true }
  )));
  return plans;
};

const getActivePlans = async () => {
  await seedDefaultPlans();
  const rows = await MonetizationPlan.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  if (!rows.length) return getDefaultPlans();
  return rows.map((row) => ({
    ...row,
    price: row.priceMonthly,
    durationDays: SUBSCRIPTION_PLANS[row.code]?.durationDays || 30,
    benefits: {
      ...(SUBSCRIPTION_PLANS[row.code]?.benefits || {}),
      ...(row.benefits || {}),
    },
  }));
};

const getPlanByCode = async (code) => {
  const normalizedCode = getPlanCode(code);
  const plans = await getActivePlans();
  return plans.find((plan) => plan.code === normalizedCode) || null;
};

module.exports = {
  getDefaultPlans,
  seedDefaultPlans,
  getActivePlans,
  getPlanByCode,
};
