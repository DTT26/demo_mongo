'use strict';

const CustomerFavorite = require('../models/CustomerFavorite');
const Restaurant = require('../models/Restaurant');

/**
 * Khách hàng thêm nhà hàng vào yêu thích (POST /api/v1/customer/favorites)
 */
const addFavorite = async (req, res) => {
  try {
    const { restaurantId } = req.body;
    const customerId = req.user._id;

    if (!restaurantId) {
      return res.status(400).json({ success: false, message: 'Thiếu ID nhà hàng (restaurantId)' });
    }

    // Kiểm tra nhà hàng có tồn tại không
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng này' });
    }

    // Kiểm tra xem đã có trong danh sách yêu thích chưa
    const existing = await CustomerFavorite.findOne({ customerId, restaurantId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Nhà hàng đã nằm trong danh sách yêu thích' });
    }

    // Tạo bản ghi mới
    const favorite = new CustomerFavorite({
      customerId,
      restaurantId,
    });

    await favorite.save();

    return res.status(201).json({
      success: true,
      message: 'Đã thêm nhà hàng vào danh sách yêu thích',
      data: favorite,
    });
  } catch (error) {
    console.error('❌ [AddFavorite] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu yêu thích' });
  }
};

/**
 * Khách hàng bỏ yêu thích nhà hàng (DELETE /api/v1/customer/favorites/:restaurantId)
 */
const removeFavorite = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const customerId = req.user._id;

    const favorite = await CustomerFavorite.findOneAndDelete({ customerId, restaurantId });
    if (!favorite) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không nằm trong danh sách yêu thích' });
    }

    return res.json({
      success: true,
      message: 'Đã xóa nhà hàng khỏi danh sách yêu thích',
    });
  } catch (error) {
    console.error('❌ [RemoveFavorite] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi bỏ yêu thích' });
  }
};

/**
 * Lấy danh sách nhà hàng yêu thích của khách hàng (GET /api/v1/customer/favorites)
 */
const getMyFavorites = async (req, res) => {
  try {
    const customerId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const { search } = req.query;

    let favoriteQuery = { customerId };

    // Lấy toàn bộ danh sách yêu thích trước
    let favorites = await CustomerFavorite.find(favoriteQuery)
      .populate({
        path: 'restaurantId',
        select: 'name logo coverImage galleryImages images averageRating cuisineTypes address description averagePrice active approvalStatus',
      })
      .sort({ createdAt: -1 });

    // Lọc các nhà hàng bị null (đã bị xóa khỏi DB) hoặc không hoạt động
    favorites = favorites.filter(fav => fav.restaurantId && fav.restaurantId.active && fav.restaurantId.approvalStatus === 'approved');

    // Nếu có từ khóa tìm kiếm (search), lọc theo tên nhà hàng, loại ẩm thực hoặc địa chỉ
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      favorites = favorites.filter(fav => {
        const nameMatch = fav.restaurantId.name && searchRegex.test(fav.restaurantId.name);
        const cuisineMatch = Array.isArray(fav.restaurantId.cuisineTypes) && fav.restaurantId.cuisineTypes.some(c => searchRegex.test(c));
        const addressMatch = fav.restaurantId.address && fav.restaurantId.address.fullAddress && searchRegex.test(fav.restaurantId.address.fullAddress);
        return nameMatch || cuisineMatch || addressMatch;
      });
    }

    // Thực hiện phân trang thủ công trên tập kết quả đã filter
    const total = favorites.length;
    const paginatedFavorites = favorites.slice(skip, skip + limit);

    return res.json({
      success: true,
      data: paginatedFavorites,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetMyFavorites] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách yêu thích' });
  }
};

/**
 * Lấy mảng IDs nhà hàng đã yêu thích để hỗ trợ FE kiểm tra trạng thái nhanh (GET /api/v1/customer/favorites/ids)
 */
const getFavoriteIds = async (req, res) => {
  try {
    const customerId = req.user._id;

    const favorites = await CustomerFavorite.find({ customerId }).select('restaurantId');
    const ids = favorites.map(fav => fav.restaurantId.toString());

    return res.json({
      success: true,
      data: ids,
    });
  } catch (error) {
    console.error('❌ [GetFavoriteIds] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách ID yêu thích' });
  }
};

module.exports = {
  addFavorite,
  removeFavorite,
  getMyFavorites,
  getFavoriteIds,
};
