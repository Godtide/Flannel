const truffleAssert = require('truffle-assertions');
const h = require('chainlink-test-helpers')

contract('Flannel', accounts => {
  const Oracle = artifacts.require('Oracle');
  const Flannel = artifacts.require('Flannel');
  const TestnetConsumer = artifacts.require('TestnetConsumer')
  const LinkToken = artifacts.require('LinkTokenInterface')
  const UniswapInterface = artifacts.require('UniswapExchangeInterface')
  const AaveLendingInterface = artifacts.require('LendingPool')
  const AToken = artifacts.require('AToken')
  
  const unlockedTestAccount = '0x1A4A8483564e7d1Be536cDc39B3958b79F6F7015'
  
  const uniswapRopsten = '0x4426F644f5999Aef8A7d87F0Af6e0755E94a2588'
  const stdLinkTokenRopsten = '0x20fe562d797a42dcb3399062ae9546cd06f63280'
  const aaveLinkTokenRopsten = '0x1a906E71FF9e28d8E01460639EB8CF0a6f0e2486'
  const aaveApprovalRopsten = '0x4295Ee704716950A4dE7438086d6f0FBC0BA9472'
  const aaveLendingPoolRopsten = '0x9E5C7835E4b13368fd628196C4f1c6cEc89673Fa'
  const aLinkInterestToken = '0x52fd99c15e6FFf8D4CF1B83b2263a501FDd78973'

  const owner = accounts[0]
  const oracleNode = accounts[1]
  const stranger = accounts[2]

  const jobId = '4c7b7ffb66b344fbaa64995af81e355a'
  const dummyResponse = web3.utils.numberToHex('12345');
  const costOfReq = (web3.utils.toWei('5', 'ether'));

  let stdLinkToken, aaveLinkToken, uniswap, lendingPool, oracle, testnetConsumer, flannel

  beforeEach(async () => {
    stdLinkToken = await LinkToken.at(stdLinkTokenRopsten);
    aaveLinkToken = await LinkToken.at(aaveLinkTokenRopsten);
    uniswap = await UniswapInterface.at(uniswapRopsten);
    lendingPool = await AaveLendingInterface.at(aaveLendingPoolRopsten);
    aLinkIntToken = await AToken.at(aLinkInterestToken);

    oracle = await Oracle.new(stdLinkToken.address);
    testnetConsumer = await TestnetConsumer.new(stdLinkToken.address);
    flannel = await Flannel.new(uniswap.address, stdLinkToken.address, aaveLinkToken.address, aLinkIntToken.address, oracle.address, oracleNode, lendingPool.address, aaveApprovalRopsten);

    await flannel.configureOracleSetup(oracle.address, oracleNode);

    await oracle.setFulfillmentPermission(oracleNode, true, { from: owner })
    await oracle.transferOwnership(flannel.address, { from: owner })

    await stdLinkToken.transfer(testnetConsumer.address, `${5e18}`, {from: unlockedTestAccount})
    await aaveLinkToken.transfer(flannel.address, `${5e18}`, {from: unlockedTestAccount})

    tx = await testnetConsumer.requestEthereumPrice(oracle.address, jobId)
    request = h.decodeRunRequest(tx.receipt.rawLogs[3])
    await h.fulfillOracleRequest(oracle, request, dummyResponse, { from: oracleNode })
  })

  context('Flannel - Threshold Functions', () => {
    // [0] = Name
    // [1] = Percent Untouched
    // [2] = Percent Aave
    // [3] = Percent Top-Up
    // [4] = Link Threshold
    // [5] = Eth Threshold
    // [6] = Aave Threshold (LINK)
    // [7] = Eth Top-Up
    let defTestSet = ["Default",  20, 60, 20, web3.utils.toWei('5', 'ether'), web3.utils.toWei('1', 'ether'), web3.utils.toWei('10', 'ether'), web3.utils.toWei('300', 'finney')];
    let newTestSet = ["Test Set", 40, 40, 20, web3.utils.toWei('10', 'ether'), web3.utils.toWei('2', 'finney'),web3.utils.toWei('5', 'ether'),  web3.utils.toWei('5', 'finney')];
    let badTestSet = ["Test Set", 40, 50, 20, web3.utils.toWei('10', 'ether'), web3.utils.toWei('2', 'finney'), web3.utils.toWei('10', 'ether'), web3.utils.toWei('5', 'finney')];


    it('Checks that the default thresholds have been applied at deployment', async () => {
      defUserStoredParams = await flannel.userStoredParams.call(0);
      defTestSet.forEach(function(item, index) {
        assert.equal(defUserStoredParams[index], item);
      })
    })

    it('Can add a new parameter set', async() => {
      await flannel.createNewAllowance(newTestSet[0], newTestSet[1], newTestSet[2], newTestSet[3], newTestSet[4], newTestSet[5], newTestSet[6], newTestSet[7]);
      newUserStoredParams = await flannel.userStoredParams.call(1);
      newTestSet.forEach(function(item, index) {
        assert.equal(newUserStoredParams[index], item);
      })
    })

    it('Can track new addition counters correctly', async() => {
      pCounter = await flannel.paramCounter.call();
      pInUse = await flannel.paramsInUse.call();
      assert.equal(pCounter, 1, "Default paramCounter is incorrect");
      assert.equal(pInUse, 0, "Current params in use is incorrect");
      await flannel.createNewAllowance(newTestSet[0], newTestSet[1], newTestSet[2], newTestSet[3], newTestSet[4], newTestSet[5], newTestSet[6], newTestSet[7]);
      pCounter = await flannel.paramCounter.call();
      pInUse = await flannel.paramsInUse.call();
      assert.equal(pCounter, 2, "Addition paramCounter is incorrect");
      assert.equal(pInUse, 1, "Addition params in use is incorrect");
    })

    it('Ensures percentage variables calculate to 100', async() => {
      badpcAave = 10;
      await truffleAssert.reverts(
        flannel.createNewAllowance(badTestSet[0], badTestSet[1], badTestSet[2], badTestSet[3], badTestSet[4], badTestSet[5], badTestSet[6], newTestSet[7]),
        "Percent parameters do not equal 100");
    })

    it('Allows for different parameter sets to be selected', async() => {
      await flannel.createNewAllowance(newTestSet[0], newTestSet[1], newTestSet[2], newTestSet[3], newTestSet[4], newTestSet[5], newTestSet[6], newTestSet[7]);
      pInUse = await flannel.paramsInUse.call();
      await flannel.setParametersInUse(pInUse -1);
      pInUse = await flannel.paramsInUse.call();
      assert.equal(pInUse, 0, "Params in use have not been changed");
    })
  })

  context('Flannel - Oracle Functions', () => {
    it('Flannel can withdraw LINK from the oracle contract', async () => {
      ob = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.withdrawFromOracle(ob, {from: oracleNode});
      nb = await stdLinkToken.balanceOf.call(flannel.address);
      assert.equal(Number(ob), Number(nb), "LINK has not been successfully withdrawn from oracle");
    })

    it('Percent helper works as expected', async() => {
      answer = await flannel._percentHelper(100, 10);
      assert.equal(answer, 10, "Percent helper doesn't work");
    })

    it('Correctly portions the withdrawn funds into three allocations', async() => {
      ob = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.withdrawFromOracle(ob, {from: oracleNode});
      aaveBal = await flannel.aaveBalance.call();
      assert.equal((ob/100) * 60, aaveBal, "Aave balance incorrect");
      topUpBal = await flannel.topUpBalance.call();
      assert.equal((ob/100) * 20, topUpBal, "Top-up balance incorrect");
      storeBal = await flannel.storeBalance.call();
      assert.equal((ob/100) * 20, storeBal, "Store balance incorrect");
    })

    it('Only owner can revert ownership of oracle contract from Flannel', async() => {
      await truffleAssert.reverts(
        flannel.revertOracleOwnership({from: stranger}),
        "VM Exception while processing transaction: revert");
      await truffleAssert.reverts(
        flannel.revertOracleOwnership({from: oracleNode}),
        "VM Exception while processing transaction: revert");  
      await flannel.revertOracleOwnership({from: owner});
    })
  })

  context('Flannel - Uniswap Functions', () => {
    it('Flannel can convert LINK funds to eth and transfer to node', async () => {
      init = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.withdrawFromOracle(init, {from: oracleNode});
      topUpAllocation = await flannel.topUpBalance.call();
      ob = await web3.eth.getBalance(oracleNode);
      await flannel.linkToEthTopUp(topUpAllocation, {from: oracleNode});
      nb = await web3.eth.getBalance(oracleNode);
      assert.notEqual(Number(nb), Number(ob), "Uniswap transaction has not been successful");
    })
  })

  context('Flannel - Aave Functions', () => {
    it('Flannel can deposit aaveLINK into Aave and redeem aLINK', async() => {
      init = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.withdrawFromOracle(init, {from: oracleNode});
      ob = await aaveLinkToken.balanceOf.call(flannel.address);
      aaveAllocation = await flannel.aaveBalance.call();
      await flannel.depositToAave(aaveAllocation, {from: oracleNode});
      nb = await aaveLinkToken.balanceOf.call(flannel.address);
      diff = ob - nb;
      alinkb = await aLinkIntToken.balanceOf.call(flannel.address);
      assert.notEqual(Number(nb), Number(ob), "Aave deposit has not been successful");
      assert.equal(diff, alinkb, "aLINK has not been deposited");
    })

    it('Flannel can withdraw deposited aaveLink from Aave', async() => {
      init = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.withdrawFromOracle(init, {from: oracleNode});
      aaveAllocation = await flannel.aaveBalance.call();
      await flannel.depositToAave(aaveAllocation, {from: oracleNode});
      ob = await aLinkIntToken.balanceOf.call(flannel.address);
      await flannel.withdrawFromAave(ob, {from: oracleNode});
      nb = await aLinkIntToken.balanceOf.call(flannel.address);
      assert.notEqual(Number(nb), Number(ob), "Aave withdrawal has not been successful");
    })
  })

  context('Flannel - Function Co-ordinator', () => {
    it('Withdraws from the oracle contract correctly', async () => {
      ob = await stdLinkToken.balanceOf.call(oracle.address);
      await flannel.flannelCoordinator({from: oracleNode});
      nb = await stdLinkToken.balanceOf.call(flannel.address);
      assert.equal(Number(ob), Number(nb), "LINK has not been successfully withdrawn from oracle");
    })

    it('Tops up the node correctly', async() => {
      preLink = await stdLinkToken.balanceOf.call(oracle.address);
      await web3.eth.sendTransaction({from: oracleNode, to: stranger, value: web3.utils.toWei('99', 'ether')})
      await web3.eth.sendTransaction({from: oracleNode, to: stranger, value: web3.utils.toWei('500', 'finney')})
      ob = await web3.eth.getBalance(oracleNode);
      await flannel.flannelCoordinator({from: oracleNode});
      nb = await web3.eth.getBalance(oracleNode);
      topUpPost = await flannel.topUpBalance.call();
      assert.isBelow(Number(ob), Number(nb), "Balance has not increased");
      assert.isBelow(Number(topUpPost), (preLink/100) * 20, "topUpBalance has not decremented correctly");
    })

    it('Deposits to Aave correctly', async () => {
      await stdLinkToken.transfer(testnetConsumer.address, `${15e18}`, {from: unlockedTestAccount})
      await aaveLinkToken.transfer(flannel.address, `${15e18}`, {from: unlockedTestAccount})

      let i;
      for (i = 0; i < 3; i++) {
        tx = await testnetConsumer.requestEthereumPrice(oracle.address, jobId)
        request = h.decodeRunRequest(tx.receipt.rawLogs[3])
        await h.fulfillOracleRequest(oracle, request, dummyResponse, { from: oracleNode })
      }

      ob = await aLinkIntToken.balanceOf(flannel.address);
      await flannel.flannelCoordinator({from: oracleNode});
      nb = await aLinkIntToken.balanceOf(flannel.address);

      assert.equal(Number(ob + nb), Number(nb), "Unexpected amount of aLINK in Flannel contract");
    })
  })

})