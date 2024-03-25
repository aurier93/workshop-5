import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";


export async function node(
  nodeId: number,
  N: number, 
  F: number, 
  initialValue: Value, 
  isFaulty: boolean,
  nodesAreReady: () => boolean, 
  setNodeIsReady: (index: number) => void 
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 1,
  };
  
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  function sendMessage(k: number, x: Value, messageType: string) {
    for (let i = 0; i < N; i++) {
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ k: k, x: x, messageType: messageType })
      });
    }
  }

  function handleProposal(k: number, x: Value) {
    !proposals.has(k) && proposals.set(k, []);
    proposals.get(k)!.push(x);
  
    if (proposals.get(k)!.length >= (N - F)) {
      const count0 = proposals.get(k)!.filter(el => el === 0).length;
      const count1 = proposals.get(k)!.length - count0;

      const consensus = count0 > (N / 2) ? 0 : (count1 > (N / 2) ? 1 : "?");
      
      sendMessage(k, consensus, "vote");
    }
  }
  
  function handleVote(k: number, x: Value) {
    !votes.has(k) && votes.set(k, []);
    votes.get(k)!.push(x);
  
    const votesArray = votes.get(k)!;
    if (votesArray.length >= (N - F)) {
      const count0 = votesArray.filter(el => el === 0).length;
      const count1 = votesArray.length - count0; 

      if (count0 >= F + 1 || count1 >= F + 1) {
        state.x = count0 > count1 ? 0 : 1;
        state.decided = true;
      } else {
        state.x = count0 === count1 ? Math.random() > 0.5 ? 0 : 1 : count0 > count1 ? 0 : 1;
        state.k = k + 1;
        
        sendMessage(state.k, state.x, "propose");
      }
    }
  }

  node.post("/message", async (req, res) => {
    if (isFaulty || state.killed) {
      res.status(400).send("Node is faulty or killed");
      return;
    }
    const { k, x, messageType } = req.body;
    
    messageType === "propose" ? handleProposal(k, x) : handleVote(k, x);

    res.status(200).send("Message received and processed.");
  });

  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(100);
    }

    !isFaulty && sendMessage(state.k ? 1 : 0, state.x ? initialValue : 0, "propose");
    isFaulty ? res.status(500).send("The node is faulty.") : res.status(200).send("Node started.");
  });

  node.get("/stop", async (req, res) => {
    state.killed = true;
    state.x = null;
    state.decided = null;
    state.k = 0;
    res.send("The node is stopped.");
  });

  node.get("/status", (req, res) => {
    isFaulty ? res.status(500).send("faulty") : res.status(200).send("live");
  });

  node.get("/getState", (req, res) => {
    res.send(state);
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    setNodeIsReady(nodeId);
  });

  return server;
}
