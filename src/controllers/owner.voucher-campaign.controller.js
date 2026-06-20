const voucherCampaignService = require('../services/voucher-campaign.service');

const sendError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  code: error.code,
  message: error.message,
  details: error.details,
});

exports.getPackages = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: voucherCampaignService.listVoucherCampaignPackages(),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.checkout = async (req, res) => {
  try {
    const { restaurantId, voucherId, packageCode } = req.body || {};
    if (!restaurantId || !voucherId || !packageCode) {
      return res.status(400).json({
        success: false,
        message: 'restaurantId, voucherId and packageCode are required.',
      });
    }

    const data = await voucherCampaignService.createVoucherCampaignCheckout({
      ownerId: req.user._id,
      restaurantId,
      voucherId,
      packageCode,
    });

    return res.status(201).json({
      success: true,
      message: 'Voucher campaign payment link created.',
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getCampaigns = async (req, res) => {
  try {
    const data = await voucherCampaignService.getOwnerVoucherCampaignSummary({
      ownerId: req.user._id,
      restaurantId: req.query.restaurantId,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};
