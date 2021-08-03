// SPDX-License-Identifier: MIT

require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const http = require('http')
const Web3 = require('web3')
const HDWalletProvider = require('@truffle/hdwallet-provider')
const moment = require('moment-timezone')
const numeral = require('numeral')
const UNISWAP = require('@uniswap/sdk')
//console.log(`The chainId of mainnet is ${UNISWAP.ChainId.MAINNET}.`)
const SUSHI = require('@sushiswap/sdk')
const fetch = require('node-fetch')
const BigNumber = require('bignumber.js')
const ethers = require('ethers')
const bigInt = require('big-integer')
var Tx = require('ethereumjs-tx').Transaction

// Contracts ABI Config
const _uniFactoryABI = require('./contracts/uniswapFactory.json')
const _uniRouterABI = require('./contracts/uniswapRouter.json')
const _sushiFactoryABI = require('./contracts/sushiswapFactory.json')
const _sushiRouterABI = require('./contracts/sushiswapRouter.json')
const _batcherABI = require('./contracts/tb.json')
const _ercABI = require('./contracts/ERC20.json')

// LOGGING TO FILE
var fs = require('fs');
var util = require('util');
var logFile = fs.createWriteStream('log.txt', { flags: 'w' });
// 'a' or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;

console.log = function () {
  logFile.write(util.format.apply(null, arguments) + '\n');
  logStdout.write(util.format.apply(null, arguments) + '\n');
}
console.error = console.log;

// SERVER CONFIG
const PORT = process.env.PORT || 6000
const app = express();
const server = http.createServer(app).listen(PORT, () => console.log(`Listening on ${ PORT }`))
const gas = {}

// GAS CONFIG
var url = "https://www.gasnow.org/api/v3/gas/price?utm_source=:Arbitr"
var settings = { method: "Get" }

// WEB3 CONFIG
const nodeUrl = 'http://192.168.88.19:8545'
const web3 = new Web3(nodeUrl)
//const web3 = new Web3(process.env.RPC_URL)

// NODE PROVIDER CONFIG
//const currentProvider = new web3.providers.HttpProvider(nodeUrl);
//const myprovider = new ethers.providers.Web3Provider(web3.currentProvider)
const myProvider = new ethers.providers.JsonRpcProvider(nodeUrl)
const reserveProvider = new ethers.providers.InfuraProvider('homestead', {
    projectId: process.env.INFURA_PROJECT_ID,
    projectSecret: process.env.INFURA_ENDPOINT_KEY
})

// TRADE CONFIG
// SWAP = 227468
// APPROVAL = 48847
// 276315
const gasMax = 280000
const amountStep = 0.01
const startAmount = 0.1
const maxAmount = 0.9

// Trade Addresses
const account = '0xf9818a51DABD22a4835b4684f47E38d516c13f4F'
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const batcherAddress = '0xd2A7D8451D8A5168B571E1CfDCe1e531fD7EaCf3'
const batcherContract = new web3.eth.Contract(_batcherABI.abi, batcherAddress)

// UNISWAP Addresses
const factoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
const routerAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const uniFactoryContract = new web3.eth.Contract(_uniFactoryABI.abi, factoryAddress)
const uniRouterContract = new web3.eth.Contract(_uniRouterABI.abi, routerAddress)

// SUSHISWAP Addresses
const sfactoryAddress = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'
const srouterAddress = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'
const sushiFactoryContract = new web3.eth.Contract(_sushiFactoryABI.abi, sfactoryAddress)
const sushiRouterContract = new web3.eth.Contract(_sushiRouterABI.abi, srouterAddress)

//async function getPair(SWAP, fcoin, fweth, fprovider, rprovider) {
//  let pair
//  try {
//    pair = await SWAP.Fetcher.fetchPairData(fcoin, fweth, fprovider)
//  } catch(err) {
//    console.log('Uniswap Fetch ETH Node Error:', err)
//    pair = await SWAP.Fetcher.fetchPairData(fcoin, fweth, rprovider)
//  }
//  return pair
//}

async function checkPair(args) {
  const {
    outputTokenSymbol,
    outputTokenAddress,
    uniApproval,
    sushiApproval
  } = args

  var optimalAmount = web3.utils.toWei('1', 'ETHER')

  // UNISWAP Settings
  // note that you may want/need to handle this async code differently,
  // for example if top-level await is not an option
  const COIN = new UNISWAP.Token(UNISWAP.ChainId.MAINNET, outputTokenAddress, 18)

  const pair = await UNISWAP.Fetcher.fetchPairData(COIN, UNISWAP.WETH[COIN.chainId], myProvider)
  //pair = getPair(UNISWAP, COIN, UNISWAP.WETH[COIN.chainId], myProvider, reserveProvider)

  const route = new UNISWAP.Route([pair], UNISWAP.WETH[COIN.chainId])

  // SUSHISWAP Settings
  const SCOIN = new SUSHI.Token(SUSHI.ChainId.MAINNET, outputTokenAddress, 18)

  const spair = await SUSHI.Fetcher.fetchPairData(SCOIN, SUSHI.WETH[SCOIN.chainId], myProvider)

  const sroute = new SUSHI.Route([spair], SUSHI.WETH[SCOIN.chainId])

  //if (!uniApproval) { console.log('uniApproval', uniApproval) }

  // If Number of Uniswap Coins per 1 WETH more than Sushiswap Coins per 1 WETH
  if (route.midPrice.toSignificant(6) > sroute.midPrice.toSignificant(6)) {

    // Calculating Optimal Trade Amount
    // const h = Math.sqrt((spair.reserve0.toSignificant(6) * spair.reserve1.toSignificant(6) * pair.reserve0.toSignificant(6) * pair.reserve1.toSignificant(6)) / Math.pow(pair.reserve1.toSignificant(6), 2))

    // if (spair.reserve0.toSignificant(6) < h) {
    optimalAmount = web3.utils.toWei(estimateOptimalAmount(
      amountStep,
      startAmount,
      maxAmount,
      pair.reserve0.toSignificant(6),
      pair.reserve1.toSignificant(6),
      spair.reserve0.toSignificant(6),
      spair.reserve1.toSignificant(6)),
      'Ether')
    // }

    // UNISWAP Buy Settings
    const tokenamount = new UNISWAP.TokenAmount(UNISWAP.WETH[COIN.chainId], optimalAmount)
    const trade = new UNISWAP.Trade(route, tokenamount, UNISWAP.TradeType.EXACT_INPUT)

    // SUSHI Sell Settings
    const soutputAmount = bigInt(trade.executionPrice.toSignificant(6) * optimalAmount)

    //console.log([{
    //  'Token': outputTokenSymbol,
    //  'soutputAmount': soutputAmount.toString()
    //}])

    const isroute = new SUSHI.Route([spair], SCOIN)
    const istokenamount = new SUSHI.TokenAmount(SCOIN, soutputAmount)
    const istrade = new SUSHI.Trade(isroute, istokenamount, SUSHI.TradeType.EXACT_INPUT)

    //console.log([{
    //  'Token': outputTokenSymbol,
    //  'istokenamount': istokenamount,
    //  'OptimalAmount Ether': web3.utils.fromWei(optimalAmount.toString(), 'Ether'),
    //  'Result': web3.utils.fromWei((istrade.executionPrice.toSignificant(6) * soutputAmount - optimalAmount).toString(), 'Ether'),
    //}])

    // 10000000000000000
    if (bigInt(istrade.executionPrice.toSignificant(6) * soutputAmount - optimalAmount) > 10000000000000000) {
      // Gas Settings
      let response = await fetch(url, settings)

      if (response.ok) {
        let gas = await response.json()
        let PL = (istrade.executionPrice.toSignificant(6) * soutputAmount) - optimalAmount - (gasMax * gas.data.fast)

        console.log([{
          'Token': outputTokenSymbol,
          'Amount': web3.utils.fromWei(optimalAmount.toString(), 'Ether'),
          'Gas': web3.utils.fromWei(gas.data.standard.toString(), 'Gwei'),
          'Tx Fee': web3.utils.fromWei((gasMax * gas.data.fast).toString(), 'Ether'),
          'Result': web3.utils.fromWei((istrade.executionPrice.toSignificant(6) * soutputAmount - optimalAmount).toString(), 'Ether'),
          'PL': web3.utils.fromWei(PL.toString(), 'Ether'),
          'Uni': route.midPrice.toSignificant(6),
          'Uni Buy': trade.executionPrice.toSignificant(6),
          'Sushi': sroute.midPrice.toSignificant(6),
          'Sushi Sell': (1 / istrade.executionPrice.toSignificant(6)).toString(),
          'UNISWAP Token Reserve': pair.reserve0.toSignificant(6),
          'UNISWAP WETH Reserve': pair.reserve1.toSignificant(6),
          'SUSHI Token Reserve': spair.reserve0.toSignificant(6),
          'SUSHI WETH Reserve': spair.reserve1.toSignificant(6),
          'Time': moment().tz('Europe/Kiev').format(),
        }])

        if (PL > 0) {
          console.log('TRADE FROM UNI TO SUSHI!!!')

          // 3000 bips, or 30.0%
          let slippageTolerance = new UNISWAP.Percent('3000', '10000')
          let cslippageTolerance = new SUSHI.Percent('3000', '10000')

          // Trade Path Setup
          let path = [UNISWAP.WETH[COIN.chainId].address, COIN.address]
          let cpath = [SCOIN.address, SUSHI.WETH[SCOIN.chainId].address]

          console.log('path:', path)
          console.log('cpath:', cpath)

          Trade(
            route,
            trade,
            path,
            slippageTolerance,
            routerAddress,
            uniRouterContract,
            isroute,
            istrade,
            cpath,
            cslippageTolerance,
            srouterAddress,
            sushiRouterContract,
            optimalAmount,
            gas.data.fast,
            outputTokenAddress,
            sushiApproval
          )

        // Wait for 30 seconds after sending transaction
        console.log("Start waiting for 30 minutes after sending transaction")
        await new Promise(resolve => setTimeout(resolve, 300000))
        console.log("End waiting for 30 minutes after sending transaction")

        }
      } else {
        console.log("HTTP Error: " + response.status)
      }
    }
  } else {
    // Calculating Optimal Trade Amount
    // const h = Math.sqrt((spair.reserve0.toSignificant(6) * spair.reserve1.toSignificant(6) * pair.reserve0.toSignificant(6) * pair.reserve1.toSignificant(6)) / Math.pow(spair.reserve1.toSignificant(6), 2))

    // if (pair.reserve0.toSignificant(6) < h) {
    optimalAmount = web3.utils.toWei(estimateOptimalAmount(
      amountStep,
      startAmount,
      maxAmount,
      spair.reserve0.toSignificant(6),
      spair.reserve1.toSignificant(6),
      pair.reserve0.toSignificant(6),
      pair.reserve1.toSignificant(6)),
      'Ether')
    // }

    // SUSHISWAP Buy Settings
    const stokenamount = new SUSHI.TokenAmount(SUSHI.WETH[SCOIN.chainId], optimalAmount)
    const strade = new SUSHI.Trade(sroute, stokenamount, SUSHI.TradeType.EXACT_INPUT)

    // UNISWAP Sell Settings
    const outputAmount = bigInt(strade.executionPrice.toSignificant(6) * optimalAmount)

    //console.log([{
    //  'Token': outputTokenSymbol,
    //  'outputAmount': outputAmount.toString(),
    //}])

    const iroute = new UNISWAP.Route([pair], COIN)
    const itokenamount = new UNISWAP.TokenAmount(COIN, outputAmount)
    const itrade = new UNISWAP.Trade(iroute, itokenamount, UNISWAP.TradeType.EXACT_INPUT)

    //console.log([{
    //  'Token': outputTokenSymbol,
    //  'OptimalAmount Ether': web3.utils.fromWei(optimalAmount, 'Ether'),
    //  'Result': web3.utils.fromWei((itrade.executionPrice.toSignificant(6) * outputAmount - optimalAmount).toString(), 'Ether'),
    //}])

    //debugger

    // 10000000000000000
    if (bigInt(itrade.executionPrice.toSignificant(6) * outputAmount - optimalAmount) > 10000000000000000) {
      // Gas Settings
      let response = await fetch(url, settings)

      if (response.ok) {
        let gas = await response.json()

	let PL = (itrade.executionPrice.toSignificant(6) * outputAmount) - optimalAmount - (gasMax * gas.data.fast)

	console.log([{
          'Token': outputTokenSymbol,
          'Amount': web3.utils.fromWei(optimalAmount.toString(), 'Ether'),
	  'Gas': web3.utils.fromWei(gas.data.fast.toString(), 'Gwei'),
          'Tx Fee': web3.utils.fromWei((gasMax * gas.data.fast).toString(), 'Ether'),
          'Result': web3.utils.fromWei((itrade.executionPrice.toSignificant(6) * outputAmount - optimalAmount).toString(), 'Ether'),
	  'PL': web3.utils.fromWei(PL.toString(), 'Ether'),
          'Sushi': sroute.midPrice.toSignificant(6),
	  'Sushi Buy': strade.executionPrice.toSignificant(6),
	  'Uni': route.midPrice.toSignificant(6),
	  'Uni Sell': (1 / itrade.executionPrice.toSignificant(6)).toString(),
          'UNISWAP Token Reserve': pair.reserve0.toSignificant(6),
          'UNISWAP WETH Reserve': pair.reserve1.toSignificant(6),
          'SUSHI Token Reserve': spair.reserve0.toSignificant(6),
          'SUSHI WETH Reserve': spair.reserve1.toSignificant(6),
          'Time': moment().tz('Europe/Kiev').format(),
        }])

        if (PL > 0) {
          console.log('TRADE FROM SUSHI TO UNI!!!')

          // 3000 bips, or 30.0%
          const cslippageTolerance = new UNISWAP.Percent('3000', '10000')
          const slippageTolerance = new SUSHI.Percent('3000', '10000')

          // Trade Path Setup
          let cpath = [COIN.address, UNISWAP.WETH[COIN.chainId].address]
          let path = [SUSHI.WETH[SCOIN.chainId].address, SCOIN.address]

          console.log('path:', path)
          console.log('cpath:', cpath)

          Trade(
            sroute,
            strade,
            path,
            slippageTolerance,
            srouterAddress,
            sushiRouterContract,
            iroute,
            itrade,
            cpath,
            cslippageTolerance,
            routerAddress,
            uniRouterContract,
            optimalAmount,
            gas.data.fast,
            outputTokenAddress,
            uniApproval
          )

        // Wait for 30 seconds after sending transaction
        console.log("Start waiting for 30 minutes after sending transaction")
        await new Promise(resolve => setTimeout(resolve, 300000))
        console.log("End waiting for 30 minutes after sending transaction")

        }
      } else {
        console.log("HTTP Error: " + response.status)
      }
    }
  }
}

function estimateOptimalAmount(amountStep, startAmount, maxAmount, buyReserveA, buyReserveB, sellReserveA, sellReserveB) {

  //a = sellK
  //b = buyK
  //c = buyReserveB
  //h = sellReserveA

  let max = new BigNumber(maxAmount.toString())
  let bRA = new BigNumber(buyReserveA.toString())
  let bRB = new BigNumber(buyReserveB.toString())
  let b = bRA.times(bRB)
  let sRA = new BigNumber(sellReserveA.toString())
  let sRB = new BigNumber(sellReserveB.toString())
  let a = sRA.times(sRB)
  let x = new BigNumber(startAmount.toString())
  let c = new BigNumber(buyReserveB.toString())
  let h = new BigNumber(sellReserveA.toString())
  let step = new BigNumber(amountStep)

  //Derivative formula: d/dx(d - x - a/(h + (x b)/(x + c)^2)) = -1 + (a (-(2 b x)/(c + x)^3 + b/(c + x)^2)) / (h + (b x)/(c + x)^2)^2
  //Derivative formula: d/dx(d - x - a/(h + (x b)/(x + c)^2)) = (a (b/(c + x)^2 - (2 b x)/(c + x)^3))/((b x)/(c + x)^2 + h)^2 - 1
  //(sellK * ( buyK / square - ((2 * buyK * x) / cube))) / divider - 1

  let square = c.plus(x).pow(2)
  let cube = c.plus(x).pow(3)
  let mult = b.times(x).div(square).plus(h)
  let divider = mult.pow(2)
  let dividend1 = b.div(square)
  let dividend2 = b.times(x).times(2).div(cube)
  let dividend = dividend1.minus(dividend2)
  let derivative = a.times(dividend).div(divider).minus(1)

  if (derivative.comparedTo(0) > 0) {
    do {
      x = x.plus(step)
      derivativePast = derivative
      square = c.plus(x).pow(2)
      cube = c.plus(x).pow(3)
      mult = b.times(x).div(square).plus(h)
      divider = mult.pow(2)
      dividend1 = b.div(square)
      dividend2 = b.times(x).times(2).div(cube)
      dividend = dividend1.minus(dividend2)
      derivative = a.times(dividend).div(divider).minus(1)
      if (derivativePast.comparedTo(derivative) > 0) {
        x = x.plus(step)
      } else
      {
        x = x.minus(step)
      }
    } while ((derivative.comparedTo(0) > 0) && (x.comparedTo(max) < 0))
  }

  return x.toString()
}

// Trade Execution
async function Trade(
    froute,
    ftrade,
    fpath,
    fslippageTolerance,
    ffromRouterAddress,
    ffromRouterContract,
    fcroute,
    fctrade,
    fcpath,
    fcslippageTolerance,
    ftoRouterAddress,
    ftoRouterContract,
    famountIn,
    fgasTx,
    ftokenAddress,
    ftokenApproval)
  {
    let ercContract = new web3.eth.Contract(_ercABI.abi, ftokenAddress)

    web3.eth.getBalance(account, (err, result) => { console.log("account balance: ", web3.utils.fromWei(result, "ether")) })
    web3.eth.getBalance(batcherAddress, (err, result) => { console.log("TB balance: ", web3.utils.fromWei(result, "ether")) })
    ercContract.methods.balanceOf(batcherAddress).call((err, result) => { console.log('token TB balance', web3.utils.fromWei(result, "ether")) })

    // Swap from ETH to Token
    // needs to be converted to e.g. hex
    let amountOutMin = ftrade.minimumAmountOut(fslippageTolerance)
    console.log('amountOutMin:', web3.utils.toWei(amountOutMin.toExact(), 'ether'))
    let amountOut = ftrade.outputAmount
    console.log('amountOut:', web3.utils.toWei(amountOut.toExact(), 'ether'))
    // 300 minutes from the current Unix time
    let deadline = Math.floor(Date.now() / 1000) + 60 * 300
    // needs to be converted to e.g. hex
    let value = ftrade.inputAmount
    console.log('value:', value.toExact())

    // Swap from Token to ETH
    let camountIn = web3.utils.toWei(amountOut.toExact(), 'ether')
    console.log('camountIn:', camountIn)
    // needs to be converted to e.g. hex
    let camountOutMin = fctrade.minimumAmountOut(fcslippageTolerance)
    console.log('amountOutMin:', web3.utils.toWei(camountOutMin.toExact(), 'ether'))
    // 300 minutes from the current Unix time
    let cdeadline = Math.floor(Date.now() / 1000) + 60 * 300
    // needs to be converted to e.g. hex
    let cvalue = fctrade.inputAmount
    console.log('cvalue:', cvalue.toExact())

    // Trade Profit
    let evalue = fctrade.outputAmount
    console.log('evalue:', evalue.toExact())
    let tradeProfit = evalue.toExact() - value.toExact()
    console.log('Trade Profit:', tradeProfit)

    console.log('fpath:', fpath)
    console.log('fcpath:', fcpath)
    console.log('famountIn:', famountIn)

    // Swap from ETH to Token
    let data = ffromRouterContract.methods.swapExactETHForTokens(
      web3.utils.toHex(web3.utils.toWei(amountOutMin.toExact(), 'ether')),
      fpath,
      batcherAddress,
      deadline
     ).encodeABI()

    // Swap from Token to ETH
    let cdata = ftoRouterContract.methods.swapExactTokensForETH(
      camountIn,
      web3.utils.toHex(web3.utils.toWei(camountOutMin.toExact(), 'ether')),
      fcpath,
      account,
      cdeadline
    ).encodeABI()

    if (ftokenApproval) {

      console.log('No Approve')

      // Batch Buy
      //let targetsArray = [ffromRouterAddress]
      //let valueArray = [famountIn]
      //let dataArray = [data]
      //let bdata = batcherContract.methods.batchSend(
      //  targetsArray,
      //  valueArray,
      //  dataArray
      //).encodeABI()

      // Batch Sell
      //let targetsArray = [ftoRouterAddress]
      //let valueArray = ['0']
      //let dataArray = [cdata]
      //let bdata = batcherContract.methods.batchSend(
      //  targetsArray,
      //  valueArray,
      //  dataArray
      //).encodeABI()

      // Batch Swap
      let targetsArray = [ffromRouterAddress, ftoRouterAddress]
      let valueArray = [famountIn, '0']
      let dataArray = [data, cdata]
      let bdata = batcherContract.methods.batchSend(
        targetsArray,
        valueArray,
        dataArray
      ).encodeABI()

      web3.eth.getTransactionCount(account, (err, txCount) => {

        gasTx = fgasTx + 10000
        console.log('gasTx: ', web3.utils.fromWei(gasTx.toString(), 'gwei'))

        // Batch Swap
        let btxObject = {
          nonce: web3.utils.toHex(txCount),
          gasLimit: web3.utils.toHex(500000),
          gasPrice: web3.utils.toHex(gasTx),
          to: batcherAddress,
          data: bdata,
          value: web3.utils.toHex(famountIn)
        }

        //debugger

        // TX Execution
        let btx = new Tx(btxObject, { chain: 'mainnet' })
        btx.sign(Buffer.from('', 'hex'))

        let bserializedTransaction = btx.serialize()
        let braw = "0x" + bserializedTransaction.toString("hex")

        debugger

        //web3.eth.sendSignedTransaction(braw, (err, txHash) => { console.log("txHash: ", txHash, "Error:", err) })
      })
    } else {

      console.log('Approved Token: ', ftokenAddress)
      console.log('Approved Platform: ', ftoRouterAddress)

      // Approve Token Spending Limit from batchSend: 68,739
      //let approve = ercContract.methods.approve(
      //  ftoRouterAddress,
      //  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      //).encodeABI()

      // Batch Approve
      //let atargetsArray = [ftokenAddress]
      //let avalueArray = ['0']
      //let adataArray = [approve]
      //var abdata = batcherContract.methods.batchSend(
      //  atargetsArray,
      //  avalueArray,
      //  adataArray
      //).encodeABI()

      // Approve Token Spending Limit from approveFromContract: 49,729
      let abdata = batcherContract.methods.approveFromContract(
        ftokenAddress,
        ftoRouterAddress,
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      ).encodeABI()

      web3.eth.getTransactionCount(account, (err, txCount) => {

        gasTx = fgasTx + 10000
        console.log('gasTx: ', web3.utils.fromWei(gasTx.toString(), 'gwei'))

        let abtxObject = {
            nonce: web3.utils.toHex(txCount),
            gasLimit: web3.utils.toHex(200000),
            gasPrice: web3.utils.toHex(gasTx),
            to: batcherAddress,
            data: abdata,
            value: web3.utils.toHex('0')
        }

        let abtx = new Tx(abtxObject, { chain: 'mainnet' })
        abtx.sign(Buffer.from('', 'hex'))

        let abserializedTransaction = abtx.serialize()
        let abraw = "0x" + abserializedTransaction.toString("hex")

        //web3.eth.sendSignedTransaction(abraw, (err, txHash) => { console.log("txHash: ", txHash, "Error:", err) })

        // Batch Swap
        let targetsArray = [ffromRouterAddress, ftoRouterAddress]
        let valueArray = [famountIn, '0']
        let dataArray = [data, cdata]
        let bdata = batcherContract.methods.batchSend(
          targetsArray,
          valueArray,
          dataArray
        ).encodeABI()

        // Batch Swap
        let btxObject = {
          nonce: web3.utils.toHex(txCount + 1),
          gasLimit: web3.utils.toHex(500000),
          gasPrice: web3.utils.toHex(gasTx),
          to: batcherAddress,
          data: bdata,
          value: web3.utils.toHex(famountIn)
        }

        //debugger

        // TX Execution
        let btx = new Tx(btxObject, { chain: 'mainnet' })
        btx.sign(Buffer.from('', 'hex'))

        let bserializedTransaction = btx.serialize()
        let braw = "0x" + bserializedTransaction.toString("hex")

        debugger

        //web3.eth.sendSignedTransaction(braw, (err, txHash) => { console.log("txHash: ", txHash, "Error:", err) })
      })
    }
    console.log('After tx')
    debugger
}

let priceMonitor
let monitoringPrice = false

async function monitorPrice() {
  if(monitoringPrice) {
    return
  }

  console.log('Checking prices... ', moment().tz('Europe/Kiev').format())
  monitoringPrice = true

  try {

    let uniSushiRaw = fs.readFileSync('./tokens/uni_sushi.json')
    let uniSushi = JSON.parse(uniSushiRaw)
    //console.log("Number of tokens: ", uniSushi.tokens.length)

    for (let i = 0; i < uniSushi.tokens.length; i++) {
      await checkPair(uniSushi.tokens[i])
    }
  } catch (error) {
    console.error('checkPair Error: ', error)
    monitoringPrice = false
    clearInterval(priceMonitor)
    return
  }

  monitoringPrice = false
}

// Check Markets Every n Seconds
const POLLING_INTERVAL = process.env.POLLING_INTERVAL || 1000 // 1 Second
priceMonitor = setInterval(async () => { await monitorPrice() }, POLLING_INTERVAL)
