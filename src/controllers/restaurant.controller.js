'use strict';

const Restaurant = require('../models/Restaurant');

/**
 * GET /api/v1/restaurants
 * Public endpoint to list approved, active, and non-deleted restaurants
 */
const getRestaurants = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const cuisineType = (req.query.cuisineType || '').trim();
    const priceRange = (req.query.priceRange || '').trim();
    const city = (req.query.city || '').trim();
    const featured = req.query.featured;

    // Base query: only approved, active, not deleted, and completed (has menu & tables)
    const filter = {
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      hasMenu: true,
      hasTableLayout: true,
    };

    // Filters
    if (cuisineType) {
      filter.cuisineTypes = cuisineType;
    }

    if (city) {
      filter['address.city'] = { $regex: city, $options: 'i' };
    }

    if (featured !== undefined) {
      filter.featured = featured === 'true';
    }

    // Price range filter
    if (priceRange === 'low') {
      filter.averagePrice = { $lt: 200000 };
    } else if (priceRange === 'medium') {
      filter.averagePrice = { $gte: 200000, $lte: 500000 };
    } else if (priceRange === 'high') {
      filter.averagePrice = { $gt: 500000 };
    }

    // Search by name, cuisine types, or full address
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.fullAddress': { $regex: search, $options: 'i' } },
      ];
    }

    // Sort mapping
    const sortBy = req.query.sortBy || 'name';
    const sortDir = req.query.sortDir === 'desc' ? -1 : 1;
    
    // Map frontend sort fields to Mongoose schema fields
    let sortField = 'name';
    if (sortBy === 'restaurantName' || sortBy === 'name') {
      sortField = 'name';
    } else if (sortBy === 'averageRating') {
      sortField = 'stats.averageRating';
    } else if (sortBy === 'averagePrice') {
      sortField = 'averagePrice';
    } else if (sortBy === 'totalBookings') {
      sortField = 'stats.totalBookings';
    } else if (sortBy === 'createdAt') {
      sortField = 'createdAt';
    }

    const sortObj = { [sortField]: sortDir };

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Restaurant.countDocuments(filter),
    ]);

    // Map to public JSON representation
    const formatted = restaurants.map((r) => {
      // Find primary image or fallback to first image or null
      const primaryImage = r.images?.find((img) => img.isPrimary)?.url || r.images?.[0]?.url || null;
      
      return {
        id: r._id.toString(),
        name: r.name,
        description: r.description,
        phoneNumber: r.phoneNumber,
        email: r.email,
        address: r.address?.fullAddress || [r.address?.street, r.address?.district, r.address?.city].filter(Boolean).join(', '),
        logo: r.logo,
        coverImageUrl: primaryImage,
        averagePrice: r.averagePrice,
        priceRangeMin: r.priceRangeMin,
        priceRangeMax: r.priceRangeMax,
        priceRange: r.priceRange,
        cuisineType: r.cuisineTypes?.[0] || 'Đang cập nhật',
        cuisineTypes: r.cuisineTypes || [],
        averageRating: r.stats?.averageRating || 0,
        reviewCount: r.stats?.totalReviews || 0,
        stats: r.stats,
        featured: r.featured,
        createdAt: r.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        restaurants: formatted,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Public/GetRestaurants] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tải danh sách nhà hàng' });
  }
};

/**
 * GET /api/v1/restaurants/cuisine-types
 * Public endpoint to fetch all unique cuisine types of approved restaurants
 */
const getCuisineTypes = async (req, res) => {
  try {
    const cuisineTypes = await Restaurant.distinct('cuisineTypes', {
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      hasMenu: true,
      hasTableLayout: true,
    });
    
    return res.status(200).json({
      success: true,
      data: cuisineTypes.filter(Boolean),
    });
  } catch (error) {
    console.error('❌ [Public/GetCuisineTypes] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tải loại ẩm thực' });
  }
};

/**
 * GET /api/v1/restaurants/:id
 * Public endpoint to view a single restaurant's detail
 */
const getRestaurantById = async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({
      _id: req.params.id,
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      hasMenu: true,
      hasTableLayout: true,
    });

    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng hoặc nhà hàng chưa được kích hoạt' });
    }

    const primaryImage = restaurant.images?.find((img) => img.isPrimary)?.url || restaurant.images?.[0]?.url || null;

    return res.status(200).json({
      success: true,
      data: {
        id: restaurant._id.toString(),
        name: restaurant.name,
        description: restaurant.description,
        phoneNumber: restaurant.phoneNumber,
        email: restaurant.email,
        websiteUrl: restaurant.websiteUrl,
        contactHotline: restaurant.contactHotline,
        address: restaurant.address,
        coordinates: restaurant.coordinates,
        cuisineTypes: restaurant.cuisineTypes,
        priceRange: restaurant.priceRange,
        capacity: restaurant.capacity,
        operatingHours: restaurant.operatingHours,
        logo: restaurant.logo,
        coverImageUrl: primaryImage,
        images: restaurant.images,
        averagePrice: restaurant.averagePrice,
        priceRangeMin: restaurant.priceRangeMin,
        priceRangeMax: restaurant.priceRangeMax,
        statusMessage: restaurant.statusMessage,
        bookingNotes: restaurant.bookingNotes,
        summaryHighlights: restaurant.summaryHighlights,
        suitableFor: restaurant.suitableFor,
        signatureDishes: restaurant.signatureDishes,
        amenities: restaurant.amenities,
        policyRules: restaurant.policyRules,
        stats: restaurant.stats,
        featured: restaurant.featured,
        createdAt: restaurant.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ [Public/GetRestaurantDetail] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tải thông tin nhà hàng' });
  }
};

module.exports = {
  getRestaurants,
  getCuisineTypes,
  getRestaurantById,
};
