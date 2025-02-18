import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import { io } from 'socket.io-client';


export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const [socket, setSocket] = useState(null); // State to hold the socket connection
  const socketRef = useRef(null); // Use useRef to hold the socket instance persistently



  async function startSession() {
    // Get an ephemeral key from the Fastify server
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      message.event_id = message.event_id || crypto.randomUUID();
      dataChannel.send(JSON.stringify(message));
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }

  const sendEventToServer = (eventName, eventData) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(eventName, eventData);
      console.log(`Sent event '${eventName}' to server with data:`, eventData);
    } else {
      console.warn("WebSocket is not connected. Cannot send event.");
    }
  };

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }


  const webSocketBackend = () => {
    try {
      if (socketRef.current && (socketRef.current.connected || socketRef.current.connecting)) {
        console.log("WebSocket connection already active or connecting. Skipping new connection.");
        return; // Exit if already connected or connecting
      }

      const newSocket = io('http://127.0.0.1:5000'); // Create a new socket instance

      socketRef.current = newSocket; // Store the socket instance in the ref

      // Event listeners for socket events
      newSocket.on('connect', () => {
        console.log('Connected to WebSocket server!');
        setIsConnected(true); // Update connection status
        setMessages(prevMessages => [...prevMessages, 'Connected to server!']);
      });

      newSocket.on('message', (data) => {
        console.log('Received server message:', data);
        setMessages(prevMessages => [...prevMessages, `Server Message: ${data.data}`]);
      });

      newSocket.on('server_response', (data) => {
        console.log('Received server response:', data);
        setMessages(prevMessages => [...prevMessages, `Server Response: ${data.data}`]);
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server.');
        setIsConnected(false); // Update connection status
        setMessages(prevMessages => [...prevMessages, 'Disconnected from server.']);
      });


    } catch (err) {
      console.error("WebSocket connection error:", err);
    }
  };

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    webSocketBackend()
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        console.log("message:");
        
        console.log(e);
        console.log('\n');
        if(JSON.parse(e.data).type === "response.output_item.done"){
          let message = {
            type: "session.update",
            session: {
              instructions: "You are Deadpool(the marvel character)"
            },
          }
          sendClientEvent(message)
        }
        setEvents((prev) => [JSON.parse(e.data), ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }

    return () => { // Cleanup function
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
          />
        </section>
      </main>
    </>
  );
}
