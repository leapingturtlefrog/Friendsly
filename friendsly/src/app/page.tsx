"use client";
import React, { useState, useEffect } from "react";

export default function Page() {
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [userId] = useState(() => Math.random().toString(36).substr(2, 6));
  const [queue, setQueueState] = useState([]);

  const getQueue = () => JSON.parse(localStorage.getItem('queue') || '[]');
  const saveQueue = (queue) => localStorage.setItem('queue', JSON.stringify(queue));

  // Poll queue every 2 seconds to check position
  useEffect(() => {
    const interval = setInterval(() => {
      setQueueState(getQueue());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const goLive = () => {
    const creatorName = prompt("Your name:") || "Creator";
    setRole("creator");
    setName(creatorName);
    localStorage.setItem('creator', creatorName);
    saveQueue([]);
    setQueueState([]);
  };

  const joinQueue = () => {
    const fanName = prompt("Your name:") || "Fan";
    setRole("fan");
    setName(fanName);
    const currentQueue = getQueue();
    currentQueue.push({id: userId, name: fanName});
    saveQueue(currentQueue);
    setQueueState(currentQueue);
  };

  const nextFan = () => {
    const currentQueue = getQueue();
    currentQueue.shift(); // Remove first person
    saveQueue(currentQueue);
    setQueueState(currentQueue);
  };

  const isActive = role === "creator" || (role === "fan" && queue[0]?.id === userId);
  const position = queue.findIndex(f => f.id === userId) + 1;

  if (isActive) {
    return (
      <div>
        <div style={{background:"#333", color:"white", padding:"10px"}}>
          {role === "creator" ? `🔴 ${name} - Queue: ${queue.length}` : "💬 Your turn!"}
          {role === "creator" && <button onClick={nextFan} style={{float:"right"}}>Next</button>}
        </div>
        <iframe src="https://beancan.daily.co/iQjfQ32MxYYT2rOsmZ0v" 
                allow="camera; microphone" style={{width:"100%",height:"90vh",border:0}} />
      </div>
    );
  }

  return (
    <div style={{padding:"50px", textAlign:"center"}}>
      <h1>Friendsly</h1>
      <button onClick={goLive} style={{padding:"20px", margin:"10px", background:"red", color:"white", border:"none"}}>Go Live</button>
      <button onClick={joinQueue} style={{padding:"20px", margin:"10px", background:"green", color:"white", border:"none"}}>Join Queue</button>
      {position > 0 && <p>Queue position: {position} - Wait for your turn!</p>}
    </div>
  );
}
