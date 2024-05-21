import { CurrencyDefinition, EstimateConversionResponse, GetCurrencyResponse, ListCurrenciesResponse } from "verus-typescript-primitives";
import { VerusdRpcInterface } from "verusd-rpc-ts-client";
import { RpcRequestResultError, RpcRequestResultSuccess } from "verusd-rpc-ts-client/lib/types/RpcRequest";

const SOURCE_CURRENCY = "VRSC";
const AMOUNT = 750;
const RPC_USER = "";
const RPC_PASS = "";
const RPC_PORT = 27486;
const SYSTEM_ID = "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";

type Convertable = {
  via?: CurrencyDefinition;
  destination: CurrencyDefinition;
  exportto?: CurrencyDefinition;
  price: number;
  viapriceinroot?: number;
  destpriceinvia?: number;
  gateway: boolean;
};

type Convertables = {
  [key: string]: Array<Convertable>;
};

type PathLevelUnit = {
  path: Convertable,
  amount: number
}

type PathLevel = {
  [key: string]: Array<PathLevelUnit>
}

type PathTree = Array<Array<PathLevelUnit>>;

const verus = new VerusdRpcInterface(SYSTEM_ID, `http://localhost:${RPC_PORT}`, {
  auth: {
    username: RPC_USER,
    password: RPC_PASS
  },
});

const unwrapResult = <T>(rpcresult: RpcRequestResultError | RpcRequestResultSuccess) => {
  if (rpcresult.error != null) {
    throw new Error(rpcresult.error.message);
  } else return rpcresult.result as T;
}

const findConversionPaths = async (source: CurrencyDefinition) => {
  const paths = await verus.getCurrencyConversionPaths(source);

  const prelaunchCurrenciesRes = unwrapResult<ListCurrenciesResponse["result"]>(await verus.listCurrencies({ launchstate: "prelaunch" }));
  const prelaunchCurrencyIds = prelaunchCurrenciesRes.map(x => x.currencydefinition.currencyid)
  
  for (const destinationid in paths) {
    paths[destinationid] = paths[destinationid].filter(x => {
      if (prelaunchCurrencyIds != null && prelaunchCurrencyIds.includes(x.destination.currencyid)) {
        return false
      } else return true;
    });
  }

  return paths;
}

const getLevelFromConvertables = async (convertables: Convertables, source: CurrencyDefinition, amount: number): Promise<PathLevel> => {
  const level: PathLevel = {};

  for (const currencyid in convertables) {
    const options = convertables[currencyid];

    for (const convertable of options) {
      if (convertable.exportto || convertable.gateway) continue;

      const estimate = unwrapResult<EstimateConversionResponse["result"]>(await verus.estimateConversion({
        currency: source.currencyid,
        amount,
        convertto: convertable.destination.currencyid,
        via: convertable.via ? convertable.via.currencyid : undefined
      }));

      if (!level[convertable.destination.currencyid]) level[convertable.destination.currencyid] = [];

      level[convertable.destination.currencyid].push({
        path: convertable,
        amount: estimate.estimatedcurrencyout
      })
    }
  }

  return level;
}

const addLevel = async (tree: PathTree, root: CurrencyDefinition, target?: CurrencyDefinition): Promise<PathTree> => {
  const newTree = [];

  for (let i = 0; i < tree.length; i++) {
    const levelUnits = tree[i];
    const latestUnit = levelUnits[levelUnits.length - 1];

    const sourceDefinition = latestUnit.path.destination;
    const converts = await findConversionPaths(sourceDefinition);

    if (!target || converts[target.currencyid]) {
      let convertables: Convertables;

      if (target) {
        convertables = { [target.currencyid]: converts[target.currencyid] } ;
      } else {
        convertables = {};

        for (const currencyid in converts) {
          const options = converts[currencyid].filter(
            x => ((!latestUnit.path.via || !x.via || (x.via && x.via.currencyid !== latestUnit.path.via.currencyid && x.via.currencyid !== root.currencyid))
                  && x.destination.currencyid !== root.currencyid)
          );

          if (options.length > 0) {
            convertables[currencyid] = options;
          }
        }
      }

      const nextLevel = await getLevelFromConvertables(
        convertables, 
        sourceDefinition, 
        latestUnit.amount
      );

      if (target && nextLevel[target.currencyid]) {
        const steps = tree[i];

        for (const unit of nextLevel[target.currencyid]) {
          newTree.push([...steps, unit]);
        }
      } else if (!target) {
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
}

const initTree = async (sourceDefinition: CurrencyDefinition, amount: number): Promise<PathTree> => {
  const converts = await findConversionPaths(sourceDefinition);

  const tree: PathTree = [];
  const level = await getLevelFromConvertables(converts, sourceDefinition, amount);

  for (const currencyid in level) {
    for (const unit of level[currencyid]) {
      tree.push([unit]);
    }
  }

  return tree;
}

const pruneTreeMirrors = (tree: PathTree, sourceid: string): PathTree => {
  const newTree = [];

  for (const option of tree) {
    const conversions = [sourceid];

    for (const unit of option) {
      if (unit.path.via) conversions.push(unit.path.via.currencyid);
      conversions.push(unit.path.destination.currencyid);
    }

    const firstHalf = conversions.slice(0, conversions.length / 2);
    let secondHalf;

    if (conversions.length % 2 === 0) {
      secondHalf = conversions.slice(conversions.length / 2);
    } else {
      secondHalf = conversions.slice((conversions.length / 2) + 1);
    }

    secondHalf.reverse();

    if (firstHalf.join('') !== secondHalf.join('')) {
      newTree.push(option);
    }
  }

  return newTree;
}

async function main() {
  try {
    const sourceDefinition = unwrapResult<GetCurrencyResponse["result"]>(await verus.getCurrency(SOURCE_CURRENCY));

    let tree = await initTree(sourceDefinition, AMOUNT);
    tree = await addLevel(tree, sourceDefinition, sourceDefinition);

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
  } catch(e) {
    console.error(e)
  }
}

main()