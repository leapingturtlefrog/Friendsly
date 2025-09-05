"use client";
import React, { useState, useEffect } from "react";
import { sb } from "./supabase";

// Generate a simple UUID for this session
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default function Page() {
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [isActive, setIsActive] = useState(false);

  // Initialize user ID
  useEffect(() => {
    setUserId(generateUUID());
  }, []);

  // Real-time subscription for fans to watch their queue status
  useEffect(() => {
    if (!userId || role !== "fan") return;

    // Subscribe to changes in the queue for this user
    const subscription = sb
      .channel('queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log('Queue change:', payload);
          if (payload.eventType === 'UPDATE') {
            const newStatus = payload.new.status;
            if (newStatus === 'active') {
              setIsActive(true);
            } else if (newStatus === 'done') {
              // Fan was kicked out or finished
              setIsActive(false);
              setRole("");
              setName("");
            }
          } else if (payload.eventType === 'DELETE') {
            // Fan was removed from queue
            setIsActive(false);
            setRole("");
            setName("");
          }
        }
      )
      .subscribe();

    // Also do initial polling as backup
    const checkStatus = async () => {
      const { data } = await sb.from("queue").select("status").eq("user_id", userId).single();
      if (data?.status === "active") {
        setIsActive(true);
      } else if (data?.status === "done" || !data) {
        setIsActive(false);
        if (role === "fan") {
          setRole("");
          setName("");
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [userId, role]);

  // Release on unload for fans
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (userId && role === "fan" && isActive) {
        await sb.rpc("release_active", { p_user: userId });
        // Promote next person after releasing
        await sb.rpc("promote_next");
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (userId && role === "fan" && isActive) {
        sb.rpc("release_active", { p_user: userId }).then(() => {
          sb.rpc("promote_next");
        });
      }
    };
  }, [userId, role, isActive]);

  const goLive = () => {
    if (!userId) {
      alert("Please wait for initialization to complete");
      return;
    }
    const hostName = prompt("Your name:") || "Host";
    setRole("host");
    setName(hostName);
    setIsActive(true);
  };

  const joinQueue = async () => {
    if (!userId) {
      alert("Please wait for initialization to complete");
      return;
    }
    const fanName = prompt("Your name:") || "Fan";
    setRole("fan");
    setName(fanName);
    const { error } = await sb.from("queue").insert({ user_id: userId, name: fanName });
    if (error) {
      console.error("Failed to join queue:", error);
      alert("Failed to join queue. Please try again.");
    }
  };

  const nextFan = async () => {
    // First, get the current active user to release them
    const { data: currentActive } = await sb.from("queue")
      .select("user_id")
      .eq("status", "active")
      .single();
    
    if (currentActive) {
      // Release the current active user (this will trigger the real-time update)
      await sb.rpc("release_active", { p_user: currentActive.user_id });
    }
    
    // Promote the next person in queue
    const { data: promoted } = await sb.rpc("promote_next");
    
    if (!promoted || promoted.length === 0) {
      alert("No one else in queue!");
    }
  };

  const leaveFan = async () => {
    if (userId && role === "fan") {
      await sb.rpc("release_active", { p_user: userId });
      // Promote next person after leaving
      await sb.rpc("promote_next");
      setIsActive(false);
      setRole("");
      setName("");
    }
  };

  if (isActive) {
    return (
      <div>
        <div style={{background:"#333", color:"white", padding:"10px"}}>
          {role === "host" ? `🔴 ${name} - Live` : "💬 Your turn!"}
          {role === "host" && <button onClick={nextFan} style={{float:"right", marginLeft:"10px"}}>Next</button>}
          {role === "fan" && <button onClick={leaveFan} style={{float:"right", marginLeft:"10px", background:"#666"}}>Leave</button>}
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
      {role === "fan" && name && <p>Waiting in queue...</p>}
    </div>
  );
}
