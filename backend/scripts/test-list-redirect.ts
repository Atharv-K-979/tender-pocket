import axios from 'axios';

async function testRedirect() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/JL53sZLVYU9Id7vIthEgT3Yzyfxh4tWLbT5bYUVqE0IWpociUbr5F6LU__lodHk3MrBP8kkYyldyvjaUUDFFA1bHzyIvmg4nz5MCsLE9GukuRlOjM6Tw4pd_sBkr4bnog_zTqDpIFGa8hqP_xeaj7csI5FS2AIa2vpdH91xgLtHPxCyJJDrzVa--40_FgiXnXNW4PaoREELnd-l9gWm0vhghV-v_GRdISk3Kj9-QKOGyThfNk97agBmfHYODQYLLlK18pJcZmdKfkjxYMPArNjFELi9DvqyWFZ1I22kvBYMAh7x8avqLtENt1c4cilcIbN34CXGkDjazy7zVVV6JqMJRbBFB7Y_xjp4";

  console.log("Sending GET request to:", url);
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tender247.com/'
      },
      maxRedirects: 5
    });

    console.log("Status Code:", res.status);
    console.log("Resolved Final URL:", res.request.res.responseUrl || res.config.url);
    console.log("HTML Body snippet:", res.data.substring(0, 1000));
  } catch (err: any) {
    console.error("Failed to fetch redirect!");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Headers:", err.response.headers);
      console.error("Data:", err.response.data);
    } else {
      console.error("Message:", err.message);
    }
  }
}

testRedirect().catch(console.error);
