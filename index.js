"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const verusd_rpc_ts_client_1 = require("verusd-rpc-ts-client");
const SOURCE_CURRENCY = "VRSC";
const AMOUNT = 750;
const RPC_USER = "";
const RPC_PASS = "";
const RPC_PORT = 27486;
const SYSTEM_ID = "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
const verus = new verusd_rpc_ts_client_1.VerusdRpcInterface(SYSTEM_ID, `http://localhost:${RPC_PORT}`, {
    auth: {
        username: RPC_USER,
        password: RPC_PASS
    },
});
const unwrapResult = (rpcresult) => {
    if (rpcresult.error != null) {
        throw new Error(rpcresult.error.message);
    }
    else
        return rpcresult.result;
};
const findConversionPaths = (source) => __awaiter(void 0, void 0, void 0, function* () {
    const paths = yield verus.getCurrencyConversionPaths(source);
    const prelaunchCurrenciesRes = unwrapResult(yield verus.listCurrencies({ launchstate: "prelaunch" }));
    const prelaunchCurrencyIds = prelaunchCurrenciesRes.map(x => x.currencydefinition.currencyid);
    for (const destinationid in paths) {
        paths[destinationid] = paths[destinationid].filter(x => {
            if (prelaunchCurrencyIds != null && prelaunchCurrencyIds.includes(x.destination.currencyid)) {
                return false;
            }
            else
                return true;
        });
    }
    return paths;
});
const getLevelFromConvertables = (convertables, source, amount) => __awaiter(void 0, void 0, void 0, function* () {
    const level = {};
    for (const currencyid in convertables) {
        const options = convertables[currencyid];
        for (const convertable of options) {
            if (convertable.exportto || convertable.gateway)
                continue;
            const estimate = unwrapResult(yield verus.estimateConversion({
                currency: source.currencyid,
                amount,
                convertto: convertable.destination.currencyid,
                via: convertable.via ? convertable.via.currencyid : undefined
            }));
            if (!level[convertable.destination.currencyid])
                level[convertable.destination.currencyid] = [];
            level[convertable.destination.currencyid].push({
                path: convertable,
                amount: estimate.estimatedcurrencyout
            });
        }
    }
    return level;
});
const addLevel = (tree, root, target) => __awaiter(void 0, void 0, void 0, function* () {
    const newTree = [];
    for (let i = 0; i < tree.length; i++) {
        const levelUnits = tree[i];
        const latestUnit = levelUnits[levelUnits.length - 1];
        const sourceDefinition = latestUnit.path.destination;
        const converts = yield findConversionPaths(sourceDefinition);
        if (!target || converts[target.currencyid]) {
            let convertables;
            if (target) {
                convertables = { [target.currencyid]: converts[target.currencyid] };
            }
            else {
                convertables = {};
                for (const currencyid in converts) {
                    const options = converts[currencyid].filter(x => ((!latestUnit.path.via || !x.via || (x.via && x.via.currencyid !== latestUnit.path.via.currencyid && x.via.currencyid !== root.currencyid))
                        && x.destination.currencyid !== root.currencyid));
                    if (options.length > 0) {
                        convertables[currencyid] = options;
                    }
                }
            }
            const nextLevel = yield getLevelFromConvertables(convertables, sourceDefinition, latestUnit.amount);
            if (target && nextLevel[target.currencyid]) {
                const steps = tree[i];
                for (const unit of nextLevel[target.currencyid]) {
                    newTree.push([...steps, unit]);
                }
            }
            else if (!target) {
                const steps = tree[i];
                for (const currencyid in nextLevel) {
                    for (const unit of nextLevel[currencyid]) {
                        newTree.push([...steps, unit]);
                    }
                }
            }
        }
    }
    return newTree;
});
const initTree = (sourceDefinition, amount) => __awaiter(void 0, void 0, void 0, function* () {
    const converts = yield findConversionPaths(sourceDefinition);
    const tree = [];
    const level = yield getLevelFromConvertables(converts, sourceDefinition, amount);
    for (const currencyid in level) {
        for (const unit of level[currencyid]) {
            tree.push([unit]);
        }
    }
    return tree;
});
const pruneTreeMirrors = (tree, sourceid) => {
    const newTree = [];
    for (const option of tree) {
        const conversions = [sourceid];
        for (const unit of option) {
            if (unit.path.via)
                conversions.push(unit.path.via.currencyid);
            conversions.push(unit.path.destination.currencyid);
        }
        const firstHalf = conversions.slice(0, conversions.length / 2);
        let secondHalf;
        if (conversions.length % 2 === 0) {
            secondHalf = conversions.slice(conversions.length / 2);
        }
        else {
            secondHalf = conversions.slice((conversions.length / 2) + 1);
        }
        secondHalf.reverse();
        if (firstHalf.join('') !== secondHalf.join('')) {
            newTree.push(option);
        }
    }
    return newTree;
};
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sourceDefinition = unwrapResult(yield verus.getCurrency(SOURCE_CURRENCY));
            let tree = yield initTree(sourceDefinition, AMOUNT);
            tree = yield addLevel(tree, sourceDefinition, sourceDefinition);
            // let twoHeightTree = await initTree(sourceDefinition, AMOUNT);
            // twoHeightTree = await addLevel(twoHeightTree, sourceDefinition);
            // twoHeightTree = await addLevel(twoHeightTree, sourceDefinition, sourceDefinition);
            // tree = tree.concat(twoHeightTree);
            tree.sort((a, b) => {
                const aRes = a[a.length - 1].amount;
                const bRes = b[b.length - 1].amount;
                return bRes - aRes;
            });
            tree = pruneTreeMirrors(tree, sourceDefinition.currencyid);
            for (const option of tree) {
                const conversionLog = [`${AMOUNT} ${sourceDefinition.fullyqualifiedname}`];
                for (const unit of option) {
                    conversionLog.push(`${unit.amount} ${unit.path.destination.fullyqualifiedname} ${unit.path.via ? `via ${unit.path.via.fullyqualifiedname}` : "direct"}`);
                }
                console.log(conversionLog.join(" -> "));
            }
        }
        catch (e) {
            console.error(e);
        }
    });
}
main();
