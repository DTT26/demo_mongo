const featuredPlacementService = require('../services/featured-placement.service');

exports.getFeaturedPackages = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: featuredPlacementService.listFeaturedPackages(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkoutFeaturedPlacement = async (req, res) => {
  try {
    const { restaurantId, packageCode } = req.body || {};
    if (!restaurantId || !packageCode) {
      return res.status(400).json({
        success: false,
        message: 'restaurantId and packageCode are required.',
      });
    }

    const data = await featuredPlacementService.createFeaturedCheckout({
      ownerId: req.user._id,
      restaurantId,
      packageCode,
    });

    return res.status(201).json({
      success: true,
      message: 'Featured payment link created.',
      data,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
};

exports.getFeaturedPlacements = async (req, res) => {
  try {
    const data = await featuredPlacementService.getOwnerFeaturedSummary({
      ownerId: req.user._id,
      restaurantId: req.query.restaurantId,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
};
