SELECT ROUND(100 * SUM(CASE WHEN Cuisine = 'American' THEN price ELSE 0 END) / SUM(price),2) 
AS American_Revenue
FROM orders;