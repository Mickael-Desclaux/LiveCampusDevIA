import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor pour logs (dev)
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// ============================================
// API METHODS - À implémenter feature par feature
// ============================================

export const healthCheck = () => api.get('/health');

// À ajouter progressivement :
// export const createOrder = (userId) => api.post('/api/cart/checkout', { userId });
// export const processPayment = (orderId, paymentDetails) => api.post('/api/payment', { orderId, paymentDetails });
// export const recoverCart = (token) => api.get(`/api/cart/recover/${token}`);

export default api;
