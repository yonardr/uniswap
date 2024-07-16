const {Web3} = require('web3');
const https = require('https');

// Подключение к Infura
const infuraUrl = 'https://mainnet.infura.io/v3/dab7a8bde5fd4ab6b8e8bdb7a893e2c8';
const web3 = new Web3(new Web3.providers.HttpProvider(infuraUrl));

// ABI Uniswap V2 Pair для получения резервов
const uniswapV2PairAbi = [{
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
        { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
        { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
        { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' }
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function'
}];

// Функция для выполнения HTTP-запроса к The Graph API
function fetchGraphData(query) {
    const options = {
        hostname: 'api.thegraph.com',
        path: '/subgraphs/name/uniswap/uniswap-v2',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve(parsedData);
                } catch (error) {
                    reject(`Failed to parse response: ${error.message}`);
                }
            });
        });

        req.on('error', reject);

        req.write(JSON.stringify({ query }));
        req.end();
    });
}

// Функция для получения списка пар Uniswap V2 с достаточной ликвидностью
async function getEthUsdtPairs() {
    const query = `
    {
        pairs(first: 1000, where: {volumeUSD_gt: 1000000}) {
            id
            token0 {
                symbol
            }
            token1 {
                symbol
            }
            reserve0
            reserve1
        }
    }`;

    const response = await fetchGraphData(query);

    if (!response || !response.data || !response.data.pairs) {
        throw new Error('Unexpected response structure');
    }

    const pairs = response.data.pairs;

    // Фильтрация пар с ETH и USDT
    return pairs.filter(pair =>
        (pair.token0.symbol === 'ETH' && pair.token1.symbol === 'USDT') ||
        (pair.token0.symbol === 'USDT' && pair.token1.symbol === 'ETH')
    );
}

// Функция для получения резервов и расчета цены
async function getPrice(pairAddress) {
    const pairContract = new web3.eth.Contract(uniswapV2PairAbi, pairAddress);
    const reserves = await pairContract.methods.getReserves().call();

    return (reserves._reserve0 / reserves._reserve1);  // Предполагаем, что reserve0 - это ETH, reserve1 - USDT
}

// Основная функция для выполнения анализа арбитража
async function main() {
    if (!web3.currentProvider) {
        console.error('Failed to connect to the Ethereum network');
        return;
    }

    console.log(`Connected to Ethereum network: ${infuraUrl}`);

    try {
        const pairs = await getEthUsdtPairs();
        if (pairs.length < 2) {
            console.error('Недостаточно пулов с ETH/USDT для арбитража');
            return;
        }

        // Выбираем два пула для анализа
        const pair1 = pairs[0];
        const pair2 = pairs[1];

        // Получение цен на двух пулах
        const price1 = await getPrice(pair1.id);
        const price2 = await getPrice(pair2.id);

        // Расчет разницы в цене в процентах
        const priceDifference = Math.abs(price1 - price2) / ((price1 + price2) / 2) * 100;

        // Вывод результатов
        console.log(`Pool 1 Address: ${pair1.id}`);
        console.log(`Pool 2 Address: ${pair2.id}`);
        console.log(`Price on Pool 1: ${price1.toFixed(6)} USDT/ETH`);
        console.log(`Price on Pool 2: ${price2.toFixed(6)} USDT/ETH`);
        console.log(`Price Difference: ${priceDifference.toFixed(2)}%`);

        if (priceDifference > 0.5) {
            console.log("Arbitrage opportunity detected!");
        } else {
            console.log("No arbitrage opportunity.");
        }

        // Получение текущей цены газа
        const gasPrice = await web3.eth.getGasPrice();
        console.log(`Gas Price: ${gasPrice} Wei`);

        // Оценка затрат на газ (в среднем 200000 gas)
        const gasCost = gasPrice * 200000;
        console.log(`Gas Cost (in Wei): ${gasCost}`);

        // Примерная стоимость газа в USDT
        const averageEthUsdtPrice = (price1 + price2) / 2;  // Средняя цена ETH/USDT
        const gasCostUsdt = (gasCost / 1e18) * averageEthUsdtPrice;
        console.log(`Gas Cost (in USDT): ${gasCostUsdt.toFixed(6)} USDT`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// Запуск основного скрипта
main().catch(console.error);