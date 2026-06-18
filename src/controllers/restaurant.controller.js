'use strict';

const restaurantQueryService = require('../services/restaurant-query.service');

/**
 * GET /api/v1/restaurants
 * Public endpoint to list approved, active, and non-deleted restaurants.
 */
const getRestaurants = async (req, res) => {
  try {
    const data = await restaurantQueryService.searchPublicRestaurants(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[Public/GetRestaurants] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Loi he thong khi tai danh sach nha hang',
    });
  }
};

/**
 * GET /api/v1/restaurants/cuisine-types
 * Public endpoint to fetch all unique cuisine types of approved restaurants.
 */
const getCuisineTypes = async (req, res) => {
  try {
    const cuisineTypes = await restaurantQueryService.getPublicCuisineTypes();
    return res.status(200).json({ success: true, data: cuisineTypes });
  } catch (error) {
    console.error('[Public/GetCuisineTypes] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Loi he thong khi tai loai am thuc',
    });
  }
};

/**
 * GET /api/v1/restaurants/:id
 * Public endpoint to view a single restaurant's detail.
 */
const getRestaurantById = async (req, res) => {
  try {
    const restaurant = await restaurantQueryService.getPublicRestaurantDetail(req.params.id);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Khong tim thay nha hang hoac nha hang chua duoc kich hoat',
      });
    }

    return res.status(200).json({ success: true, data: restaurant });
  } catch (error) {
    console.error('[Public/GetRestaurantDetail] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Loi he thong khi tai thong tin nha hang',
    });
  }
};

module.exports = {
  getRestaurants,
  getCuisineTypes,
  getRestaurantById,
};
