export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const page = req.query.page || 1;

  try {
    const response = await fetch(
      `https://api.vnda.com.br/api/v2/orders?per_page=100&status=confirmed&page=${page}`,
      {
        headers: {
          'authorization': 'Bearer msMS9hx2Cssbk4KZ5x2Q2Xtx',
          'X-Shop-Host': 'www.vmfashionstore.com.br',
          'accept': 'application/json'
        }
      }
    );

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
