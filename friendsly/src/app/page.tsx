"use client";
import React, { useState, useEffect } from "react";
import { sb } from "./supabase";

export default function Page() {
  // Auth states
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  
  // Existing states
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [isActive, setIsActive] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queuePosition, setQueuePosition] = useState(0);

  // Auth form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedRole, setSelectedRole] = useState<"creator" | "fan">("fan");
  const [isLogin, setIsLogin] = useState(true);

  // Initialize auth
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const role = session.user.user_metadata?.role || "fan";
        setUserRole(role);
        setName(session.user.user_metadata?.name || session.user.email?.split('@')[0] || "User");
        setUserId(session.user.id);
      }
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user);
        const role = session.user.user_metadata?.role || "fan";
        setUserRole(role);
        setName(session.user.user_metadata?.name || session.user.email?.split('@')[0] || "User");
        setUserId(session.user.id);
      } else {
        setUser(null);
        setUserRole("");
        setRole("");
        setName("");
        setUserId("");
      }
    });

    return () => subscription.unsubscribe();
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
            }
          } else if (payload.eventType === 'DELETE') {
            // Fan was removed from queue
            setIsActive(false);
            setRole("");
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

  // Fetch queue count for hosts
  useEffect(() => {
    if (role !== "host") return;

    const fetchQueueCount = async () => {
      const { count } = await sb
        .from("queue")
        .select("*", { count: 'exact', head: true })
        .eq("status", "queued");
      
      setQueueCount(count || 0);
    };

    // Subscribe to queue changes to update count in real-time
    const subscription = sb
      .channel('queue-count-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue'
        },
        () => {
          fetchQueueCount();
        }
      )
      .subscribe();

    fetchQueueCount();
    const interval = setInterval(fetchQueueCount, 5000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [role]);

  // Fetch queue position for fans
  useEffect(() => {
    if (role !== "fan" || !userId) return;

    const fetchQueuePosition = async () => {
      // First get the current user's enq_at timestamp
      const { data: currentUser } = await sb
        .from("queue")
        .select("enq_at")
        .eq("user_id", userId)
        .single();

      if (currentUser) {
        // Count how many people joined before this user and are still waiting
        const { count } = await sb
          .from("queue")
          .select("*", { count: 'exact', head: true })
          .eq("status", "queued")
          .lt("enq_at", currentUser.enq_at);

        setQueuePosition(count || 0);
      }
    };

    // Subscribe to queue changes to update position in real-time
    const subscription = sb
      .channel('queue-position-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue'
        },
        () => {
          fetchQueuePosition();
        }
      )
      .subscribe();

    fetchQueuePosition();
    const interval = setInterval(fetchQueuePosition, 3000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [role, userId]);

  // Auth functions
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await sb.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: displayName,
              role: selectedRole
            }
          }
        });
        if (error) throw error;
        alert("Check your email for verification!");
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const goLive = async () => {
    if (userRole !== "creator") {
      alert("Only creators can go live!");
      return;
    }
    
    // Clear all existing queue entries by setting them to "done"
    await sb
      .from("queue")
      .update({ status: "done" })
      .neq("status", "done");
    
    setRole("host");
    setIsActive(true);
  };

  const joinQueue = async () => {
    if (userRole !== "fan") {
      alert("Only fans can join the queue!");
      return;
    }
    
    setRole("fan");
    const { error } = await sb.from("queue").insert({ user_id: userId, name });
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
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={{padding:"50px", textAlign:"center"}}>
        <p>Loading...</p>
      </div>
    );
  }

  // Auth form
  if (!user) {
    return (
      <div style={{maxWidth:"400px", margin:"50px auto", padding:"20px"}}>
        <h1>Friendsly</h1>
        <h2>{isLogin ? "Sign In" : "Create Account"}</h2>
        
        <form onSubmit={handleAuth}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{width:"100%", padding:"10px", margin:"5px 0", boxSizing:"border-box"}}
          />
          
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{width:"100%", padding:"10px", margin:"5px 0", boxSizing:"border-box"}}
          />

          {!isLogin && (
            <>
              <input
                type="text"
                placeholder="Your Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{width:"100%", padding:"10px", margin:"5px 0", boxSizing:"border-box"}}
              />
              
              <div style={{margin:"10px 0"}}>
                <label style={{marginRight:"20px"}}>
                  <input
                    type="radio"
                    value="fan"
                    checked={selectedRole === 'fan'}
                    onChange={(e) => setSelectedRole(e.target.value as 'fan')}
                  />
                  Fan
                </label>
                <label>
                  <input
                    type="radio"
                    value="creator"
                    checked={selectedRole === 'creator'}
                    onChange={(e) => setSelectedRole(e.target.value as 'creator')}
                  />
                  Creator
                </label>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{width:"100%", padding:"12px", background:"#007bff", color:"white", border:"none", margin:"10px 0", cursor: loading ? "not-allowed" : "pointer"}}
          >
            {loading ? "Loading..." : (isLogin ? "Sign In" : "Create Account")}
          </button>
        </form>

        <button
          onClick={() => setIsLogin(!isLogin)}
          style={{background:"none", border:"none", color:"#007bff", cursor:"pointer"}}
        >
          {isLogin ? "Need an account? Sign Up" : "Have an account? Sign In"}
        </button>
      </div>
    );
  }

  // Active session UI
  if (isActive) {
    return (
      <div>
        <div style={{background:"#333", color:"white", padding:"10px"}}>
          {role === "host" ? `🔴 ${name} - Live` : "💬 Your turn!"}
          {role === "host" && <button onClick={nextFan} style={{float:"right", marginLeft:"10px"}}>Next ({queueCount})</button>}
          {role === "fan" && <button onClick={leaveFan} style={{float:"right", marginLeft:"10px", background:"#666"}}>Leave</button>}
          <button onClick={() => sb.auth.signOut()} style={{float:"right", background:"#666", marginLeft:"10px"}}>Sign Out</button>
        </div>
        <iframe src="https://beancan.daily.co/iQjfQ32MxYYT2rOsmZ0v" 
                allow="camera; microphone" style={{width:"100%",height:"90vh",border:0}} />
      </div>
    );
  }

  // Main dashboard
  return (
    <div style={{padding:"50px", textAlign:"center"}}>
      <div style={{position:"absolute", top:"10px", right:"10px"}}>
        <span style={{marginRight:"10px"}}>{name} ({userRole})</span>
        <button onClick={() => sb.auth.signOut()} style={{padding:"5px 10px", background:"#666", color:"white", border:"none"}}>
          Sign Out
        </button>
      </div>
      
      <h1>Friendsly</h1>
      
      {userRole === "creator" && (
        <button onClick={goLive} style={{padding:"20px", margin:"10px", background:"red", color:"white", border:"none"}}>
          Go Live
        </button>
      )}
      
      {userRole === "fan" && (
        <button onClick={joinQueue} style={{padding:"20px", margin:"10px", background:"green", color:"white", border:"none"}}>
          Join Queue
        </button>
      )}
      
      {role === "fan" && <p>{queuePosition} people in front of you</p>}
    </div>
  );
}